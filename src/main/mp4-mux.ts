/*
 * A progressive MP4 muxer for the WebCodecs recording path. The capture worker
 * encodes the game's window to H.264 (avc1) in **software** — which the game's
 * GPU load cannot corrupt the way it corrupts the hardware NVENC path that
 * `MediaRecorder` uses — and its system audio to AAC (mp4a), and ships the
 * encoded samples here. This assembles them into an ordinary `ftyp` + `moov` +
 * `mdat` file with real sample tables and a correct duration, so every player
 * shows the whole recording.
 *
 * The bytes themselves are streamed to two scratch files as they arrive (one
 * per track), so a long recording never has to sit in memory; only each
 * sample's size/duration/sync flag is kept. `buildHeader` turns that bookkeeping
 * into the file's head, laid out for an `mdat` whose video block comes first and
 * audio block second — which is the order the caller then appends the two
 * scratch files in.
 */

export interface MuxVideoConfig {
  avcC: Buffer
  width: number
  height: number
}
export interface MuxAudioConfig {
  asc: Buffer
  channels: number
  sampleRate: number
}
export interface SampleMeta {
  size: number
  duration: number
  sync: boolean
}
export interface MuxTrackVideo {
  config: MuxVideoConfig
  timescale: number
  samples: SampleMeta[]
}
export interface MuxTrackAudio {
  config: MuxAudioConfig
  timescale: number
  samples: SampleMeta[]
}

const MOVIE_TIMESCALE = 1000

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}
function fullbox(type: string, version: number, flags: number, ...parts: Buffer[]): Buffer {
  const vf = Buffer.alloc(4)
  vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0)
  return box(type, vf, ...parts)
}
function u16(n: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n, 0)
  return b
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0, 0)
  return b
}

// --- AAC esds (ES/DecoderConfig/DecoderSpecific/SL descriptors) ---------------
function descriptor(tag: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag, payload.length]), payload])
}
function esds(asc: Buffer): Buffer {
  const decSpecific = descriptor(0x05, asc)
  const dcd = descriptor(
    0x04,
    Buffer.concat([
      Buffer.from([0x40, 0x15]), // AAC audio (0x40), streamType audio (0x15)
      Buffer.from([0x00, 0x00, 0x00]), // bufferSizeDB
      u32(0), // maxBitrate
      u32(0), // avgBitrate
      decSpecific
    ])
  )
  const sl = descriptor(0x06, Buffer.from([0x02]))
  const es = descriptor(0x03, Buffer.concat([u16(0), Buffer.from([0x00]), dcd, sl]))
  return fullbox('esds', 0, 0, es)
}

// --- sample entries -----------------------------------------------------------
function avc1(width: number, height: number, avcC: Buffer): Buffer {
  const pre = Buffer.alloc(78)
  pre.writeUInt16BE(1, 6) // data_reference_index
  pre.writeUInt16BE(width, 24)
  pre.writeUInt16BE(height, 26)
  pre.writeUInt32BE(0x00480000, 28) // horizresolution 72dpi
  pre.writeUInt32BE(0x00480000, 32) // vertresolution
  pre.writeUInt16BE(1, 40) // frame_count
  pre.writeUInt16BE(0x0018, 74) // depth
  pre.writeUInt16BE(0xffff, 76) // pre_defined = -1
  return box('avc1', pre, box('avcC', avcC))
}
function mp4a(channels: number, sampleRate: number, asc: Buffer): Buffer {
  const pre = Buffer.alloc(28)
  pre.writeUInt16BE(1, 6) // data_reference_index
  pre.writeUInt16BE(channels, 16)
  pre.writeUInt16BE(16, 18) // samplesize
  pre.writeUInt32BE((sampleRate * 0x10000) >>> 0, 24) // 16.16 fixed
  return box('mp4a', pre, esds(asc))
}

// --- stbl tables --------------------------------------------------------------
function stts(durations: number[]): Buffer {
  const runs: { count: number; delta: number }[] = []
  for (const d of durations) {
    const last = runs[runs.length - 1]
    if (last && last.delta === d) last.count++
    else runs.push({ count: 1, delta: d })
  }
  const parts = [u32(runs.length)]
  for (const r of runs) parts.push(u32(r.count), u32(r.delta))
  return fullbox('stts', 0, 0, ...parts)
}
function stsz(sizes: number[]): Buffer {
  const parts = [u32(0), u32(sizes.length)]
  for (const s of sizes) parts.push(u32(s))
  return fullbox('stsz', 0, 0, ...parts)
}
function stss(samples: SampleMeta[]): Buffer | null {
  const sync: number[] = []
  samples.forEach((s, i) => {
    if (s.sync) sync.push(i + 1)
  })
  if (sync.length === 0 || sync.length === samples.length) return null
  const parts = [u32(sync.length)]
  for (const n of sync) parts.push(u32(n))
  return fullbox('stss', 0, 0, ...parts)
}
function stbl(sampleEntry: Buffer, samples: SampleMeta[], withSync: boolean): Buffer {
  const sync = withSync ? stss(samples) : null
  return box(
    'stbl',
    fullbox('stsd', 0, 0, u32(1), sampleEntry),
    stts(samples.map((s) => s.duration)),
    ...(sync ? [sync] : []),
    // one chunk holding every sample of the track
    fullbox('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    stsz(samples.map((s) => s.size)),
    fullbox('stco', 0, 0, u32(1), u32(0)) // offset patched once the layout is known
  )
}

function mdhd(timescale: number, duration: number): Buffer {
  const b = Buffer.alloc(20) // creation(4) mod(4) timescale(4) duration(4) lang(2) pre(2)
  b.writeUInt32BE(timescale, 8)
  b.writeUInt32BE(duration >>> 0, 12)
  b.writeUInt16BE(0x55c4, 16) // 'und'
  return fullbox('mdhd', 0, 0, b)
}
function hdlr(handler: string, name: string): Buffer {
  return fullbox(
    'hdlr',
    0,
    0,
    Buffer.concat([
      u32(0),
      Buffer.from(handler, 'latin1'),
      Buffer.alloc(12),
      Buffer.from(name + '\0', 'latin1')
    ])
  )
}
function dinf(): Buffer {
  return box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)))
}
function tkhd(
  trackId: number,
  durationMovie: number,
  width: number,
  height: number,
  isAudio: boolean
): Buffer {
  const b = Buffer.alloc(80)
  b.writeUInt32BE(trackId, 8)
  b.writeUInt32BE(durationMovie >>> 0, 16)
  if (isAudio) b.writeUInt16BE(0x0100, 32) // volume 1.0
  const mtx = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]
  for (let i = 0; i < 9; i++) b.writeUInt32BE(mtx[i] >>> 0, 36 + i * 4)
  if (!isAudio) {
    b.writeUInt32BE((width * 0x10000) >>> 0, 72)
    b.writeUInt32BE((height * 0x10000) >>> 0, 76)
  }
  return fullbox('tkhd', 0, 7, b) // enabled | in movie | in preview
}
function mvhd(duration: number, nextTrackId: number): Buffer {
  const b = Buffer.alloc(96)
  b.writeUInt32BE(MOVIE_TIMESCALE, 8)
  b.writeUInt32BE(duration >>> 0, 12)
  b.writeUInt32BE(0x00010000, 16) // rate 1.0
  b.writeUInt16BE(0x0100, 20) // volume 1.0
  const mtx = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]
  for (let i = 0; i < 9; i++) b.writeUInt32BE(mtx[i] >>> 0, 24 + i * 4)
  b.writeUInt32BE(nextTrackId, 92)
  return fullbox('mvhd', 0, 0, b)
}

function trak(
  trackId: number,
  isAudio: boolean,
  timescale: number,
  samples: SampleMeta[],
  sampleEntry: Buffer,
  width: number,
  height: number
): { buf: Buffer; movieDuration: number } {
  const trackDuration = samples.reduce((a, s) => a + s.duration, 0)
  const movDur = Math.round((trackDuration * MOVIE_TIMESCALE) / timescale)
  const minf = box(
    'minf',
    isAudio ? fullbox('smhd', 0, 0, Buffer.alloc(4)) : fullbox('vmhd', 0, 1, Buffer.alloc(8)),
    dinf(),
    stbl(sampleEntry, samples, !isAudio)
  )
  const mdia = box(
    'mdia',
    mdhd(timescale, trackDuration),
    hdlr(isAudio ? 'soun' : 'vide', isAudio ? 'SoundHandler' : 'VideoHandler'),
    minf
  )
  return { buf: box('trak', tkhd(trackId, movDur, width, height, isAudio), mdia), movieDuration: movDur }
}

/**
 * The file head — `ftyp` + `moov` + the `mdat` box header — sized and offset for
 * an `mdat` whose payload is the video track's samples (concatenated, in order)
 * followed by the audio track's. The caller writes `head`, then the video
 * scratch file's bytes, then the audio scratch file's, and the result is a
 * complete progressive MP4.
 */
export function buildHeader(video: MuxTrackVideo | null, audio: MuxTrackAudio | null): Buffer {
  const traks: Buffer[] = []
  const blockSizes: number[] = []
  let movieDuration = 0
  let trackId = 1

  if (video) {
    const t = trak(
      trackId++,
      false,
      video.timescale,
      video.samples,
      avc1(video.config.width, video.config.height, video.config.avcC),
      video.config.width,
      video.config.height
    )
    traks.push(t.buf)
    movieDuration = Math.max(movieDuration, t.movieDuration)
    blockSizes.push(video.samples.reduce((a, s) => a + s.size, 0))
  }
  if (audio) {
    const t = trak(
      trackId++,
      true,
      audio.timescale,
      audio.samples,
      mp4a(audio.config.channels, audio.config.sampleRate, audio.config.asc),
      0,
      0
    )
    traks.push(t.buf)
    movieDuration = Math.max(movieDuration, t.movieDuration)
    blockSizes.push(audio.samples.reduce((a, s) => a + s.size, 0))
  }

  const moov = box('moov', mvhd(movieDuration, trackId), ...traks)
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0x200), Buffer.from('isomiso2avc1mp41'))

  const mdatBytes = blockSizes.reduce((a, b) => a + b, 0)
  const mdatHead = Buffer.alloc(8)
  mdatHead.writeUInt32BE(8 + mdatBytes, 0)
  mdatHead.write('mdat', 4, 'latin1')

  // Patch each track's single stco entry to point at its block in the mdat,
  // which begins right after this head. The stco boxes appear in moov in track
  // order (video then audio), the same order the blocks are written.
  const payloadStart = ftyp.length + moov.length + mdatHead.length
  let running = payloadStart
  let idx = 0
  for (let i = 0; i + 8 <= moov.length && idx < blockSizes.length; i++) {
    if (moov.toString('latin1', i + 4, i + 8) === 'stco') {
      moov.writeUInt32BE(running >>> 0, i + 16)
      running += blockSizes[idx]
      idx++
    }
  }

  return Buffer.concat([ftyp, moov, mdatHead])
}
