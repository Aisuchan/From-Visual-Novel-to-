import { Mp3Encoder } from '@breezystack/lamejs'
import type { CaptureCommand, CaptureTrack } from '../../shared/ipc-types'

/*
 * The hidden capture worker. It has no UI: the main process picks the window,
 * hands it to the display-media handler and tells this page what to do with
 * the stream that comes back. Recorded bytes are shipped out chunk by chunk as
 * they arrive rather than held until the end, so a long recording never has to
 * fit in memory and an interrupted one still leaves a playable file.
 */

/** How often MediaRecorder hands over what it has, in milliseconds. */
const CHUNK_MS = 2000

/** Constant bit rate for the MP3, in kbps. */
const MP3_KBPS = 192

/**
 * How many samples per channel go into the encoder at a time. Lame wants a
 * block at a time and the worklet hands over 128 frames, so they are pooled.
 */
const MP3_BLOCK = 1152

interface Recording {
  stream: MediaStream
  recorder: MediaRecorder
  /** Resolves once the recorder has said it is done. */
  stopped: Promise<void>
  /**
   * The chain of `ondataavailable` handlers still reading their blobs. Reading
   * one is asynchronous, and `onstop` does not wait for it — with a container
   * that hands everything over at the end, that race lost the whole recording.
   */
  writing: Promise<void>
}

const recordings = new Map<CaptureTrack, Recording>()

/**
 * The audio recording, which does not go through MediaRecorder at all: this
 * runtime has no MP3 encoder (`MediaRecorder.isTypeSupported('audio/mpeg')` is
 * false, and so is every other spelling of it), so the samples are tapped off
 * the audio thread and encoded here. MP3 is a stream of self-contained frames,
 * so they can be appended to the file as they are made, exactly like the video
 * chunks are.
 */
interface AudioRecording {
  stream: MediaStream
  context: AudioContext
  node: AudioWorkletNode
  encoder: Mp3Encoder
  /** Samples waiting for a full block, one array per channel. */
  pending: Float32Array[]
}

let audioRecording: AudioRecording | null = null

/**
 * The source is whatever the main process queued for this call — the request
 * itself asks for nothing in particular.
 */
function openStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop())
}

/** The first codec the runtime actually supports, or the container default. */
function pickMimeType(candidates: string[]): string | undefined {
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

async function screenshot(): Promise<Uint8Array> {
  const stream = await openStream()
  try {
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    // `play()` resolves before anything has been painted, and a canvas drawn
    // from a video with no frame yet comes out blank.
    await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()))

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('キャンバスを準備できませんでした')
    context.drawImage(video, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG に変換できませんでした')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    stopStream(stream)
  }
}

async function startRecording(track: CaptureTrack): Promise<void> {
  if (recordings.has(track)) return

  const stream = await openStream()
  try {
    // MP4 first: it is what the files are asked to be, and this runtime does
    // encode it (H.264 + AAC). MediaRecorder writes it fragmented, so appending
    // the chunks as they arrive still leaves a file a player can open.
    const mimeType = pickMimeType([
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm'
    ])

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const recording: Recording = {
      stream,
      recorder,
      stopped: Promise.resolve(),
      writing: Promise.resolve()
    }

    recorder.ondataavailable = (event): void => {
      if (event.data.size === 0) return
      // Chained rather than awaited in place, so the chunks reach the file in
      // the order the recorder produced them.
      recording.writing = recording.writing.then(async () => {
        const data = new Uint8Array(await event.data.arrayBuffer())
        window.capture.sendChunk({ track, data })
      })
    }

    recording.stopped = new Promise<void>((resolve) => {
      recorder.onstop = (): void => resolve()
    })

    // The player closing the game pulls the stream out from under us; the file
    // is closed off rather than left half-written.
    stream.getTracks().forEach((streamTrack) => {
      streamTrack.onended = (): void => {
        if (recorder.state !== 'inactive') recorder.stop()
      }
    })

    recorder.start(CHUNK_MS)
    recordings.set(track, recording)
  } catch (error) {
    stopStream(stream)
    throw error
  }
}

async function stopRecording(track: CaptureTrack): Promise<void> {
  const recording = recordings.get(track)
  if (!recording) return
  recordings.delete(track)
  if (recording.recorder.state !== 'inactive') recording.recorder.stop()
  await recording.stopped
  // Only now is every blob actually read and on its way to the file.
  await recording.writing
  stopStream(recording.stream)
}

/** Float samples as lame wants them: 16-bit, one channel at a time. */
function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  return out
}

function sendMp3(data: Uint8Array): void {
  if (data.length > 0) window.capture.sendChunk({ track: 'audio', data })
}

/** Encodes whole blocks out of what has piled up, leaving the remainder. */
function drainPending(recording: AudioRecording, flush: boolean): void {
  const channels = recording.pending.length
  while (recording.pending[0].length >= MP3_BLOCK || (flush && recording.pending[0].length > 0)) {
    const size = Math.min(MP3_BLOCK, recording.pending[0].length)
    const left = toInt16(recording.pending[0].subarray(0, size))
    const right = channels > 1 ? toInt16(recording.pending[1].subarray(0, size)) : left
    sendMp3(recording.encoder.encodeBuffer(left, channels > 1 ? right : undefined))
    for (let c = 0; c < channels; c++) {
      recording.pending[c] = recording.pending[c].subarray(size)
    }
    if (flush && recording.pending[0].length === 0) return
  }
}

function appendPending(recording: AudioRecording, block: Float32Array[]): void {
  for (let c = 0; c < recording.pending.length; c++) {
    const incoming = block[c] ?? block[0]
    const merged = new Float32Array(recording.pending[c].length + incoming.length)
    merged.set(recording.pending[c])
    merged.set(incoming, recording.pending[c].length)
    recording.pending[c] = merged
  }
}

async function startAudio(): Promise<void> {
  if (audioRecording) return

  const stream = await openStream()
  try {
    // getDisplayMedia insists on a video track; it is dropped before anything
    // is recorded.
    stream.getVideoTracks().forEach((videoTrack) => {
      videoTrack.stop()
      stream.removeTrack(videoTrack)
    })
    if (stream.getAudioTracks().length === 0) {
      throw new Error('システム音声を取得できませんでした')
    }

    const context = new AudioContext()
    // Served verbatim out of the renderer's public folder rather than bundled:
    // `addModule` fetches a real URL, and an inlined `data:` one is exactly
    // what this page's `script-src 'self'` is there to refuse.
    await context.audioWorklet.addModule('./mp3-worklet.js')
    const source = context.createMediaStreamSource(stream)
    const channels = Math.min(2, source.channelCount || 2)
    const node = new AudioWorkletNode(context, 'mp3-tap', { numberOfInputs: 1, numberOfOutputs: 0 })

    const recording: AudioRecording = {
      stream,
      context,
      node,
      encoder: new Mp3Encoder(channels, context.sampleRate, MP3_KBPS),
      pending: Array.from({ length: channels }, () => new Float32Array(0))
    }

    node.port.onmessage = (event: MessageEvent<Float32Array[]>): void => {
      if (audioRecording !== recording) return
      appendPending(recording, event.data)
      drainPending(recording, false)
    }
    source.connect(node)

    stream.getTracks().forEach((streamTrack) => {
      streamTrack.onended = (): void => {
        void stopAudio()
      }
    })

    audioRecording = recording
  } catch (error) {
    stopStream(stream)
    throw error
  }
}

async function stopAudio(): Promise<void> {
  const recording = audioRecording
  if (!recording) return
  audioRecording = null

  recording.node.port.onmessage = null
  recording.node.disconnect()
  // Whatever did not make up a whole block still belongs in the file.
  drainPending(recording, true)
  sendMp3(recording.encoder.flush())
  await recording.context.close()
  stopStream(recording.stream)
}

async function run(command: CaptureCommand): Promise<{ png?: Uint8Array }> {
  switch (command.kind) {
    case 'screenshot':
      return { png: await screenshot() }
    case 'start-video':
      await startRecording('video')
      return {}
    case 'stop-video':
      await stopRecording('video')
      return {}
    case 'start-audio':
      await startAudio()
      return {}
    case 'stop-audio':
      await stopAudio()
      return {}
  }
}

window.capture.onCommand((command) => {
  run(command)
    .then((result) => window.capture.sendResult({ id: command.id, ...result }))
    .catch((error: unknown) =>
      window.capture.sendResult({
        id: command.id,
        error: error instanceof Error ? error.message : String(error)
      })
    )
})

window.capture.ready()
