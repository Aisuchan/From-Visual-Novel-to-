import { Mp3Encoder } from '@breezystack/lamejs'
import type { AudioFormat } from '../../shared/db-types'
import type { CaptureCommand } from '../../shared/ipc-types'

/*
 * The hidden capture worker. It has no UI: the main process picks the window,
 * hands it to the display-media handler and tells this page what to do with
 * the stream that comes back. Recorded bytes are shipped out chunk by chunk as
 * they arrive rather than held until the end, so a long recording never has to
 * fit in memory and an interrupted one still leaves a playable file.
 */

/* MediaStreamTrackProcessor is a real API in this Chromium but not yet in the
   TypeScript DOM lib, so it is declared here. It turns a track into a stream of
   the decoded frames the WebCodecs encoders take. */
declare const MediaStreamTrackProcessor: {
  new <T extends VideoFrame | AudioData = VideoFrame>(init: {
    track: MediaStreamTrack
    maxBufferSize?: number
  }): { readable: ReadableStream<T> }
}

/** Constant bit rate for the MP3, in kbps. */
const MP3_KBPS = 192

/**
 * How many samples per channel go into the encoder at a time. Lame wants a
 * block at a time and the worklet hands over 128 frames, so they are pooled.
 */
const MP3_BLOCK = 1152

/**
 * The screen recording. It does **not** go through `MediaRecorder`: that routes
 * H.264 through the GPU's hardware encoder (NVENC / Media Foundation on Windows),
 * which a game's own GPU load corrupts — the file decodes for a few seconds and
 * then throws PIPELINE_ERROR_DECODE though every frame is on disk (measured on
 * two real recordings; a screen with no game load records cleanly). WebCodecs
 * lets the H.264 be encoded in **software** (`hardwareAcceleration:
 * 'prefer-software'`), which the game cannot disturb, and the audio in AAC, and
 * the encoded samples are shipped to the main process to be muxed into an MP4.
 */
interface VideoRecording {
  stream: MediaStream
  videoEncoder: VideoEncoder
  audioEncoder: AudioEncoder | null
  vreader: ReadableStreamDefaultReader<VideoFrame>
  areader: ReadableStreamDefaultReader<AudioData> | null
  /** Resolves once both reader loops have drained, so a stop can flush safely. */
  reading: Promise<void>
}

let videoRec: VideoRecording | null = null

/** How often a keyframe is forced, in microseconds of media time. */
const KEYFRAME_INTERVAL_US = 2_000_000

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
  channels: number
  /**
   * Null when the Setting board asks for WAV, which is not an encode at all:
   * the samples go to the file as the 16-bit PCM they already nearly are,
   * behind a header the worker writes as the recording's first chunk. That is
   * why the format has to be known here rather than only where the file is
   * named — one of the two paths produces bytes the other's file cannot hold.
   */
  encoder: Mp3Encoder | null
  /** Samples waiting for a full block, one array per channel. MP3 only: a WAV
      takes whatever arrives, whenever it arrives. */
  pending: Float32Array[]
}

/** The canonical RIFF/PCM header, whose two size fields are only known once
    the recording ends — the main process patches them as it closes the file. */
const WAV_HEADER_BYTES = 44

function wavHeader(sampleRate: number, channels: number): Uint8Array {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES)
  const view = new DataView(buffer)
  const bytesPerFrame = channels * 2
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 0, true) // patched: everything after this field
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // the fmt chunk's own length
  view.setUint16(20, 1, true) // 1 = uncompressed PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerFrame, true)
  view.setUint16(32, bytesPerFrame, true)
  view.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, 0, true) // patched: the samples' own length
  return new Uint8Array(buffer)
}

let audioRecording: AudioRecording | null = null

/**
 * The source is whatever the main process queued for this call — the request
 * itself asks for nothing in particular.
 *
 * **The mouse pointer cannot be asked away here**, which is why nothing tries:
 * `getDisplayMedia` composites it into every frame and this runtime ignores
 * every shape of the constraint that should stop it. See the deferred list in
 * CLAUDE.md for what was measured. A screenshot is unaffected — it is taken in
 * the main process off `desktopCapturer`, which composites no pointer at all.
 */
function openStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop())
}

/**
 * The H.264 codec string for a resolution: baseline profile (42 E0) at the
 * lowest level that accommodates the frame, chosen by asking the encoder. The
 * level matters — `isConfigSupported` refuses a config whose level is too small
 * for the resolution — and software encoding must be available for it, which is
 * the whole point here.
 */
async function pickVideoCodec(width: number, height: number): Promise<string | null> {
  // Levels 4.0 → 6.2: enough for 1080p up through 8K.
  const levels = ['28', '29', '2a', '32', '33', '34', '3c', '3d', '3e']
  for (const level of levels) {
    const codec = `avc1.42e0${level}`
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 8_000_000,
        framerate: 30,
        hardwareAcceleration: 'prefer-software'
      })
      if (support.supported) return codec
    } catch {
      // try the next level
    }
  }
  return null
}

async function startVideo(): Promise<void> {
  if (videoRec) return

  const stream = await openStream()
  try {
    const videoTrack = stream.getVideoTracks()[0]
    const audioTrack = stream.getAudioTracks()[0] ?? null
    const settings = videoTrack.getSettings()
    const width = settings.width ?? 1920
    const height = settings.height ?? 1080

    const codec = await pickVideoCodec(width, height)
    if (!codec) throw new Error('この環境ではソフトウェアH.264エンコードに対応していません')

    // ≈0.25 bits per pixel at 30fps. The first pass was a third of this, which
    // starved the P-frames — a change could not be fully coded and the residual
    // read as ghosting on colour transitions. This is still well within software
    // encode's headroom (measured ~68fps at 1080p), and caps at 50Mbps so a very
    // large display does not ask for more than the encoder can keep up with.
    const bitrate = Math.min(50_000_000, Math.max(12_000_000, Math.round(width * height * 7.5)))

    let sentVideoConfig = false
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (!sentVideoConfig && meta?.decoderConfig?.description) {
          sentVideoConfig = true
          window.capture.sendMuxConfig({
            kind: 'video',
            avcC: new Uint8Array(meta.decoderConfig.description as ArrayBuffer),
            width,
            height
          })
        }
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        window.capture.sendMuxSample({
          kind: 'video',
          data,
          timestamp: chunk.timestamp,
          sync: chunk.type === 'key'
        })
      },
      error: (error) => {
        // eslint-disable-next-line no-console
        console.error('video encode', error)
      }
    })
    videoEncoder.configure({
      codec,
      width,
      height,
      bitrate,
      bitrateMode: 'variable', // spend bits where the picture needs them
      framerate: 30,
      avc: { format: 'avc' },
      hardwareAcceleration: 'prefer-software',
      // 'quality' rather than 'realtime': this is a recording, not a live
      // stream, so it can trade a little encode latency for better rate control.
      // The baseline codec string keeps B-frames out either way, so the muxer's
      // "decode order is presentation order" assumption still holds.
      latencyMode: 'quality'
    })

    // The audio encoder is configured from the first AudioData, since the
    // loopback stream's own sample rate and channel count are not known up front
    // (measured: a mono 48kHz loopback where the guess of stereo failed the
    // encoder outright).
    let audioEncoder: AudioEncoder | null = null
    let sentAudioConfig = false
    let audioReady = false
    let audioParams: { sampleRate: number; channels: number } | null = null
    if (audioTrack) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          if (!sentAudioConfig && meta?.decoderConfig?.description && audioParams) {
            sentAudioConfig = true
            window.capture.sendMuxConfig({
              kind: 'audio',
              asc: new Uint8Array(meta.decoderConfig.description as ArrayBuffer),
              sampleRate: audioParams.sampleRate,
              channels: audioParams.channels
            })
          }
          const data = new Uint8Array(chunk.byteLength)
          chunk.copyTo(data)
          window.capture.sendMuxSample({ kind: 'audio', data })
        },
        error: (error) => {
          // eslint-disable-next-line no-console
          console.error('audio encode', error)
        }
      })
    }

    const vproc = new MediaStreamTrackProcessor<VideoFrame>({ track: videoTrack })
    const vreader = vproc.readable.getReader()
    let areader: ReadableStreamDefaultReader<AudioData> | null = null

    let lastKeyframe = -KEYFRAME_INTERVAL_US
    const readVideo = async (): Promise<void> => {
      try {
        for (;;) {
          const { done, value } = await vreader.read()
          if (done) break
          const keyFrame = value.timestamp - lastKeyframe >= KEYFRAME_INTERVAL_US
          if (keyFrame) lastKeyframe = value.timestamp
          if (videoEncoder.state === 'configured') videoEncoder.encode(value, { keyFrame })
          value.close()
        }
      } catch {
        // The stream ended under us; the reader throws and the loop ends.
      }
    }
    const readAudio = async (): Promise<void> => {
      if (!audioTrack || !audioEncoder) return
      try {
        const aproc = new MediaStreamTrackProcessor<AudioData>({ track: audioTrack })
        const reader = aproc.readable.getReader()
        areader = reader
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!audioReady) {
            audioParams = { sampleRate: value.sampleRate, channels: value.numberOfChannels }
            audioEncoder.configure({
              codec: 'mp4a.40.2',
              sampleRate: audioParams.sampleRate,
              numberOfChannels: audioParams.channels,
              bitrate: 128_000
            })
            audioReady = true
          }
          if (audioEncoder.state === 'configured') audioEncoder.encode(value)
          value.close()
        }
      } catch {
        // As above.
      }
    }

    const reading = Promise.all([readVideo(), readAudio()]).then(() => undefined)

    // The player closing the game pulls the stream out from under us; the tracks
    // end, the readers finish, and a stop still flushes what was encoded.
    stream.getTracks().forEach((track) => {
      track.onended = (): void => {
        vreader.cancel().catch(() => undefined)
        areader?.cancel().catch(() => undefined)
      }
    })

    videoRec = { stream, videoEncoder, audioEncoder, vreader, areader, reading }
  } catch (error) {
    stopStream(stream)
    throw error
  }
}

async function stopVideo(): Promise<void> {
  const rec = videoRec
  if (!rec) return
  videoRec = null

  await rec.vreader.cancel().catch(() => undefined)
  await rec.areader?.cancel().catch(() => undefined)
  await rec.reading
  stopStream(rec.stream)

  try {
    await rec.videoEncoder.flush()
  } catch {
    // A flush on an already-errored encoder throws; the samples are already out.
  }
  rec.videoEncoder.close()
  if (rec.audioEncoder) {
    try {
      if (rec.audioEncoder.state === 'configured') await rec.audioEncoder.flush()
    } catch {
      // As above.
    }
    if (rec.audioEncoder.state !== 'closed') rec.audioEncoder.close()
  }
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

/** A WAV interleaves its channels, so a block goes out frame by frame rather
    than one channel at a time the way lame wants it. */
function sendPcm(recording: AudioRecording, block: Float32Array[]): void {
  const channels = recording.channels
  const frames = block[0]?.length ?? 0
  if (frames === 0) return
  const out = new Int16Array(frames * channels)
  for (let c = 0; c < channels; c++) {
    const samples = block[c] ?? block[0]
    for (let i = 0; i < frames; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]))
      out[i * channels + c] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    }
  }
  window.capture.sendChunk({ track: 'audio', data: new Uint8Array(out.buffer) })
}

/** Encodes whole blocks out of what has piled up, leaving the remainder. */
/** MP3 only — it is called from behind a check that there is an encoder. */
function drainPending(recording: AudioRecording, flush: boolean): void {
  const channels = recording.pending.length
  while (recording.pending[0].length >= MP3_BLOCK || (flush && recording.pending[0].length > 0)) {
    const size = Math.min(MP3_BLOCK, recording.pending[0].length)
    const left = toInt16(recording.pending[0].subarray(0, size))
    const right = channels > 1 ? toInt16(recording.pending[1].subarray(0, size)) : left
    sendMp3(recording.encoder!.encodeBuffer(left, channels > 1 ? right : undefined))
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

async function startAudio(format: AudioFormat): Promise<void> {
  if (audioRecording) return

  const stream = await openStream()
  try {
    if (stream.getAudioTracks().length === 0) {
      stopStream(stream)
      throw new Error('システム音声を取得できませんでした')
    }
    /* getDisplayMedia insists on a video track, and nothing here records it —
       but it is kept *live* rather than dropped, so the window keeps the frame
       the system draws around a capture for as long as the recording runs. It
       is stopped with the rest of the stream on `stopAudio`. */

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
      channels,
      encoder: format === 'wav' ? null : new Mp3Encoder(channels, context.sampleRate, MP3_KBPS),
      pending: Array.from({ length: channels }, () => new Float32Array(0))
    }

    // The header goes out before any samples do, so it is the front of the
    // file whichever chunk arrives next.
    if (!recording.encoder) {
      window.capture.sendChunk({
        track: 'audio',
        data: wavHeader(context.sampleRate, channels)
      })
    }

    node.port.onmessage = (event: MessageEvent<Float32Array[]>): void => {
      if (audioRecording !== recording) return
      if (!recording.encoder) {
        sendPcm(recording, event.data)
        return
      }
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
  if (recording.encoder) {
    // Whatever did not make up a whole block still belongs in the file.
    drainPending(recording, true)
    sendMp3(recording.encoder.flush())
  }
  await recording.context.close()
  stopStream(recording.stream)
}

async function run(command: CaptureCommand): Promise<{ image?: Uint8Array }> {
  switch (command.kind) {
    case 'start-video':
      await startVideo()
      return {}
    case 'stop-video':
      await stopVideo()
      return {}
    case 'start-audio':
      await startAudio(command.format)
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
