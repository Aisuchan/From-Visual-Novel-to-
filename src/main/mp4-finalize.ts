import fs from 'node:fs'
import path from 'node:path'

/*
 * **A recording is finalized before it is handed on.** MediaRecorder only ever
 * produces a *fragmented* MP4 — an `ftyp`/`moov` init segment followed by a run
 * of `moof`/`mdat` fragments — and this app writes the file by concatenating the
 * chunks as they arrive, which leaves that fragmented shape intact. The `moov`
 * of a fragmented file carries **no total duration** (`mvhd` duration is 0 and
 * the samples live out in the fragments), so a player that does not walk every
 * fragment to add the durations up cannot tell how long the video is: Windows'
 * own media stack reads the length as blank and stops after the first fragments
 * — the recording looks like it is "only a few seconds" though every frame is on
 * disk (measured: a 2-minute capture, 21MB across 102 fragments, all present).
 *
 * So the fragments are remuxed here into a plain progressive MP4: one `moov`
 * with real sample tables (`stts`/`stsz`/`stsc`/`stco`/`stss`) and correct
 * durations, over a single `mdat`. The sample *bytes* are copied through
 * untouched and the decoder configuration (`stsd`, with its `avcC`/`esds`) is
 * reused verbatim, so nothing is re-encoded — it is the same media, indexed the
 * way every player expects. Measured after: Windows reads the full 00:02:04.
 *
 * It is deliberately conservative. Anything it does not understand — a file that
 * is already progressive, a WebM fallback, a parse that does not add up, a file
 * too large to hold in memory twice — is left exactly as it was, and any error
 * leaves the original untouched: a recording is never lost to finalizing it.
 */

/** Above this the file is left fragmented rather than read into memory twice. */
const MAX_FINALIZE_BYTES = 800 * 1024 * 1024

interface ParsedBox {
  type: string
  start: number
  end: number
  dataStart: number
  dataEnd: number
}

interface Sample {
  size: number
  duration: number
  cto: number
  sync: boolean
  offset: number
}

interface Track {
  trackId: number
  timescale: number
  tkhdRaw: Buffer
  edtsRaw: Buffer | null
  mdhdRaw: Buffer
  hdlrRaw: Buffer
  mediaHeaderRaw: Buffer
  dinfRaw: Buffer
  stsdRaw: Buffer
  samples: Sample[]
}

export async function finalizeFragmentedMp4(filePath: string): Promise<void> {
  try {
    const ext = path.extname(filePath).toLowerCase()
    // Only ISO-BMFF containers; a WebM fallback is left alone.
    if (ext !== '.mp4' && ext !== '.mov') return

    const stat = await fs.promises.stat(filePath).catch(() => null)
    if (!stat || stat.size === 0 || stat.size > MAX_FINALIZE_BYTES) return

    const buf = await fs.promises.readFile(filePath)
    const out = remux(buf)
    // A file that was already progressive, or one that did not parse cleanly,
    // comes back null and is left exactly as it is.
    if (!out) return

    const tmp = filePath + '.tmp'
    await fs.promises.writeFile(tmp, out)
    await fs.promises.rename(tmp, filePath)
  } catch (error) {
    // A recording that could not be finalized is still a recording; keep it.
    // eslint-disable-next-line no-console
    console.error('MP4 finalize failed', error)
  }
}

/**
 * Returns the progressive MP4, or null when there is nothing to do (no
 * fragments) or the input does not parse into something we can rebuild.
 */
function remux(buf: Buffer): Buffer | null {
  const parse = (start: number, end: number): ParsedBox[] => {
    const list: ParsedBox[] = []
    let p = start
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p)
      const type = buf.toString('latin1', p + 4, p + 8)
      let header = 8
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(p + 8))
        header = 16
      } else if (size === 0) {
        size = end - p
      }
      if (size < header || p + size > end) break
      list.push({ type, start: p, end: p + size, dataStart: p + header, dataEnd: p + size })
      p += size
    }
    return list
  }
  const find = (list: ParsedBox[], type: string): ParsedBox | undefined =>
    list.find((b) => b.type === type)
  const children = (box: ParsedBox): ParsedBox[] => parse(box.dataStart, box.dataEnd)
  const raw = (box: ParsedBox): Buffer => Buffer.from(buf.subarray(box.start, box.end))

  const top = parse(0, buf.length)
  const ftyp = find(top, 'ftyp')
  const moov = find(top, 'moov')
  if (!ftyp || !moov) return null
  const moofs = top.filter((b) => b.type === 'moof')
  // Already progressive (or empty): nothing to finalize.
  if (moofs.length === 0) return null

  const moovChildren = children(moov)
  const mvhd = find(moovChildren, 'mvhd')
  if (!mvhd) return null
  const mvexBox = find(moovChildren, 'mvex')
  const mvhdVersion = buf.readUInt8(mvhd.dataStart)
  const movieTimescale =
    mvhdVersion === 1
      ? buf.readUInt32BE(mvhd.dataStart + 20)
      : buf.readUInt32BE(mvhd.dataStart + 12)

  const trex = new Map<number, { dur: number; size: number; flags: number }>()
  if (mvexBox) {
    for (const b of children(mvexBox)) {
      if (b.type === 'trex') {
        trex.set(buf.readUInt32BE(b.dataStart + 4), {
          dur: buf.readUInt32BE(b.dataStart + 12),
          size: buf.readUInt32BE(b.dataStart + 16),
          flags: buf.readUInt32BE(b.dataStart + 20)
        })
      }
    }
  }

  const tracks: Track[] = []
  for (const trak of moovChildren.filter((b) => b.type === 'trak')) {
    const tc = children(trak)
    const tkhd = find(tc, 'tkhd')
    const mdia = find(tc, 'mdia')
    if (!tkhd || !mdia) return null
    const mc = children(mdia)
    const mdhd = find(mc, 'mdhd')
    const hdlr = find(mc, 'hdlr')
    const minf = find(mc, 'minf')
    if (!mdhd || !hdlr || !minf) return null
    const minfc = children(minf)
    const mediaHeader = minfc.find((b) => ['vmhd', 'smhd', 'nmhd', 'sthd'].includes(b.type))
    const dinf = find(minfc, 'dinf')
    const stbl = find(minfc, 'stbl')
    if (!mediaHeader || !dinf || !stbl) return null
    const stsd = find(children(stbl), 'stsd')
    if (!stsd) return null

    const trackId = buf.readUInt32BE(tkhd.dataStart + (buf.readUInt8(tkhd.dataStart) === 1 ? 20 : 12))
    const mdhdVersion = buf.readUInt8(mdhd.dataStart)
    const timescale =
      mdhdVersion === 1
        ? buf.readUInt32BE(mdhd.dataStart + 20)
        : buf.readUInt32BE(mdhd.dataStart + 12)

    tracks.push({
      trackId,
      timescale,
      tkhdRaw: raw(tkhd),
      edtsRaw: find(tc, 'edts') ? raw(find(tc, 'edts')!) : null,
      mdhdRaw: raw(mdhd),
      hdlrRaw: raw(hdlr),
      mediaHeaderRaw: raw(mediaHeader),
      dinfRaw: raw(dinf),
      stsdRaw: raw(stsd),
      samples: []
    })
  }
  if (tracks.length === 0) return null
  const trackById = new Map(tracks.map((t) => [t.trackId, t]))

  for (const moof of moofs) {
    for (const traf of children(moof).filter((b) => b.type === 'traf')) {
      const tfhd = find(children(traf), 'tfhd')
      if (!tfhd) continue
      const flags = buf.readUInt32BE(tfhd.dataStart) & 0xffffff
      const trackId = buf.readUInt32BE(tfhd.dataStart + 4)
      const track = trackById.get(trackId)
      if (!track) continue
      let o = tfhd.dataStart + 8
      let baseDataOffset: number | null = null
      if (flags & 0x000001) {
        baseDataOffset = Number(buf.readBigUInt64BE(o))
        o += 8
      }
      if (flags & 0x000002) o += 4
      let defDur = trex.get(trackId)?.dur ?? 0
      let defSize = trex.get(trackId)?.size ?? 0
      let defFlags = trex.get(trackId)?.flags ?? 0
      if (flags & 0x000008) {
        defDur = buf.readUInt32BE(o)
        o += 4
      }
      if (flags & 0x000010) {
        defSize = buf.readUInt32BE(o)
        o += 4
      }
      if (flags & 0x000020) {
        defFlags = buf.readUInt32BE(o)
        o += 4
      }
      const base = baseDataOffset !== null ? baseDataOffset : moof.start

      for (const trun of children(traf).filter((b) => b.type === 'trun')) {
        const tf = buf.readUInt32BE(trun.dataStart) & 0xffffff
        const count = buf.readUInt32BE(trun.dataStart + 4)
        let q = trun.dataStart + 8
        let dataOffset = 0
        if (tf & 0x000001) {
          dataOffset = buf.readInt32BE(q)
          q += 4
        }
        let firstFlags: number | null = null
        if (tf & 0x000004) {
          firstFlags = buf.readUInt32BE(q)
          q += 4
        }
        let sampleOffset = base + dataOffset
        for (let i = 0; i < count; i++) {
          let dur = defDur
          let size = defSize
          let sflags = defFlags
          let cto = 0
          if (tf & 0x000100) {
            dur = buf.readUInt32BE(q)
            q += 4
          }
          if (tf & 0x000200) {
            size = buf.readUInt32BE(q)
            q += 4
          }
          if (tf & 0x000400) {
            sflags = buf.readUInt32BE(q)
            q += 4
          }
          if (tf & 0x000800) {
            cto = buf.readInt32BE(q)
            q += 4
          }
          if (i === 0 && firstFlags !== null) sflags = firstFlags
          track.samples.push({
            size,
            duration: dur,
            cto,
            sync: ((sflags >> 16) & 0x1) === 0,
            offset: sampleOffset
          })
          sampleOffset += size
        }
      }
    }
  }

  if (tracks.some((t) => t.samples.length === 0)) return null

  const box = (type: string, ...parts: Buffer[]): Buffer => {
    const body = Buffer.concat(parts)
    const head = Buffer.alloc(8)
    head.writeUInt32BE(8 + body.length, 0)
    head.write(type, 4, 'latin1')
    return Buffer.concat([head, body])
  }
  const u32 = (n: number): Buffer => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n >>> 0, 0)
    return b
  }
  const i32 = (n: number): Buffer => {
    const b = Buffer.alloc(4)
    b.writeInt32BE(n, 0)
    return b
  }

  const buildStts = (samples: Sample[]): Buffer => {
    const runs: { count: number; delta: number }[] = []
    for (const s of samples) {
      const last = runs[runs.length - 1]
      if (last && last.delta === s.duration) last.count++
      else runs.push({ count: 1, delta: s.duration })
    }
    const parts = [u32(0), u32(runs.length)]
    for (const r of runs) parts.push(u32(r.count), u32(r.delta))
    return box('stts', ...parts)
  }
  const buildCtts = (samples: Sample[]): Buffer | null => {
    if (!samples.some((s) => s.cto !== 0)) return null
    const runs: { count: number; offset: number }[] = []
    for (const s of samples) {
      const last = runs[runs.length - 1]
      if (last && last.offset === s.cto) last.count++
      else runs.push({ count: 1, offset: s.cto })
    }
    const parts = [Buffer.from([1, 0, 0, 0]), u32(runs.length)]
    for (const r of runs) parts.push(u32(r.count), i32(r.offset))
    return box('ctts', ...parts)
  }
  const buildStss = (samples: Sample[]): Buffer | null => {
    const sync: number[] = []
    samples.forEach((s, i) => {
      if (s.sync) sync.push(i + 1)
    })
    if (sync.length === 0 || sync.length === samples.length) return null
    const parts = [u32(0), u32(sync.length)]
    for (const n of sync) parts.push(u32(n))
    return box('stss', ...parts)
  }
  const buildStsz = (samples: Sample[]): Buffer => {
    const parts = [u32(0), u32(0), u32(samples.length)]
    for (const s of samples) parts.push(u32(s.size))
    return box('stsz', ...parts)
  }

  const patchDuration = (boxBuf: Buffer, v0Offset: number, v1Offset: number, value: number): void => {
    const version = boxBuf.readUInt8(8)
    if (version === 1) boxBuf.writeBigUInt64BE(BigInt(value), 8 + v1Offset)
    else boxBuf.writeUInt32BE(value >>> 0, 8 + v0Offset)
  }

  const mdatBlocks: Buffer[] = []
  const trakBufs: Buffer[] = []
  let movieDuration = 0

  for (const t of tracks) {
    mdatBlocks.push(Buffer.concat(t.samples.map((s) => buf.subarray(s.offset, s.offset + s.size))))

    const trackDuration = t.samples.reduce((a, s) => a + s.duration, 0)
    const movDur = Math.round((trackDuration * movieTimescale) / t.timescale)
    movieDuration = Math.max(movieDuration, movDur)

    const tkhd = Buffer.from(t.tkhdRaw)
    patchDuration(tkhd, 20, 28, movDur)
    const mdhd = Buffer.from(t.mdhdRaw)
    patchDuration(mdhd, 16, 24, trackDuration)

    const ctts = buildCtts(t.samples)
    const stss = buildStss(t.samples)
    const stbl = box(
      'stbl',
      t.stsdRaw,
      buildStts(t.samples),
      ...(ctts ? [ctts] : []),
      ...(stss ? [stss] : []),
      // one chunk holding every sample of the track
      box('stsc', u32(0), u32(1), u32(1), u32(t.samples.length), u32(1)),
      buildStsz(t.samples),
      box('stco', u32(0), u32(1), u32(0)) // offset patched once the layout is known
    )
    const minf = box('minf', t.mediaHeaderRaw, t.dinfRaw, stbl)
    const mdia = box('mdia', mdhd, t.hdlrRaw, minf)
    trakBufs.push(box('trak', tkhd, ...(t.edtsRaw ? [t.edtsRaw] : []), mdia))
  }

  const mvhdBuf = Buffer.from(raw(mvhd))
  patchDuration(mvhdBuf, 16, 24, movieDuration)

  const moovBuf = box('moov', mvhdBuf, ...trakBufs)
  const ftypBuf = raw(ftyp)

  // Each track is a single chunk; point its stco at where its block lands.
  const mdatPayloadStart = ftypBuf.length + moovBuf.length + 8
  let running = mdatPayloadStart
  let idx = 0
  for (let i = 0; i + 8 <= moovBuf.length && idx < mdatBlocks.length; i++) {
    if (moovBuf.toString('latin1', i + 4, i + 8) === 'stco') {
      moovBuf.writeUInt32BE(running >>> 0, i + 16)
      running += mdatBlocks[idx].length
      idx++
    }
  }

  const mdatBody = Buffer.concat(mdatBlocks)
  const mdatHead = Buffer.alloc(8)
  mdatHead.writeUInt32BE(8 + mdatBody.length, 0)
  mdatHead.write('mdat', 4, 'latin1')

  return Buffer.concat([ftypBuf, moovBuf, mdatHead, mdatBody])
}
