import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session as electronSession
} from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getSettings } from './db'
import { getOverlayWindow, loadRenderer } from './windows'
import { IpcChannels } from '../shared/ipc-types'
import type {
  CaptureChunkPayload,
  CaptureCommand,
  CaptureResultPayload,
  CaptureState,
  CaptureToggleResult,
  CaptureTrack
} from '../shared/ipc-types'

/*
 * Everything here targets one window rather than the screen, which is what
 * keeps the Recorder Panel — and every other window — out of the picture.
 * `getDisplayMedia` and `MediaRecorder` only exist in a renderer, so the work
 * happens in a hidden window and this module is the broker: it picks the
 * source, hands it to the display-media handler, and owns the files.
 */

let captureWindow: BrowserWindow | null = null
let windowReady: Promise<BrowserWindow> | null = null

let nextCommandId = 1
const pending = new Map<
  number,
  { resolve: (result: CaptureResultPayload) => void; reject: (error: Error) => void }
>()

/**
 * What the next `getDisplayMedia` call gets. The handler has no way of telling
 * which request it is answering, so the calls are serialized and this is set
 * immediately before each one.
 */
let nextDisplayMedia: { source: Electron.DesktopCapturerSource; audio: boolean } | null = null

let chain: Promise<unknown> = Promise.resolve()

/** Runs `fn` once every earlier call has finished, failures included. */
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

/**
 * The open output files. A WAV carries its own two size fields in the header
 * the worker wrote first, and neither is known until the recording ends, so
 * the bytes are counted as they go by and the header is patched on close.
 */
interface Writer {
  stream: fs.WriteStream
  filePath: string
  bytes: number
  wav: boolean
}

const writers = new Map<CaptureTrack, Writer>()

/** The header the worker writes; see `wavHeader` in the capture worker. */
const WAV_HEADER_BYTES = 44
const state: CaptureState = { video: false, audio: false }

export function getCaptureState(): CaptureState {
  return { ...state }
}

/** `2026-08-28_13-05-42` — sorts by name and is safe on every filesystem. */
function stamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  )
}

function outputPath(userDataDir: string, folder: string, gameId: number, ext: string): string {
  const dir = path.join(userDataDir, folder, String(gameId))
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${stamp()}.${ext}`)
}

/** What was launched, which is what a capture has to find a window for. */
export interface CaptureTarget {
  /** The library's own name for the game. A label the player chose. */
  title: string
  /** The executable that was launched. */
  exePath: string
  /** The process id, when there is one — an elevated launch detaches. */
  pid: number | null
}

/**
 * The window handles owned by the game's processes: the one we launched first,
 * then anything else running from the same executable, which is what a game
 * that re-launches itself through a loader leaves behind.
 *
 * Handles rather than titles because `desktopCapturer` ids carry the handle in
 * decimal — `window:789518:0` is the window whose `MainWindowHandle` is
 * 789518 — and a number survives the trip out of a console. `tasklist /V`
 * prints its titles in the OEM codepage, which turns every Japanese window
 * name into mojibake and would never match.
 */
function processWindowHandles(target: CaptureTarget): Promise<number[]> {
  const name = path.basename(target.exePath).replace(/\.exe$/i, '').replace(/'/g, "''")
  const byPid = target.pid === null ? '' : `@(Get-Process -Id ${target.pid}) + `
  const script =
    `$ErrorActionPreference='SilentlyContinue';` +
    ` ${byPid}@(Get-Process -Name '${name}') | ForEach-Object { $_.MainWindowHandle }`

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
      (error, stdout) => {
        if (error || !stdout) {
          resolve([])
          return
        }
        const handles: number[] = []
        for (const line of stdout.split(/\r?\n/)) {
          const handle = Number(line.trim())
          // 0 is "this process has no window of its own".
          if (Number.isInteger(handle) && handle > 0 && !handles.includes(handle)) {
            handles.push(handle)
          }
        }
        resolve(handles)
      }
    )
  })
}

/** A handle is stable for as long as its window is, so the lookup need not be. */
let cachedSource: { key: string; id: string } | null = null

/**
 * The game's window. It is found through the process that was launched rather
 * than through the library's name for the game, which is a label the player
 * typed and normally matches nothing on screen ("Test Game Notepad" against
 * Notepad's "無題 - メモ帳"); that mismatch is what used to drop every capture
 * through to the whole screen.
 *
 * Anything this app owns is excluded so a loose match can never land on the
 * library window or the panel itself; the screen is the last resort, and the
 * panel stays out of that through its content protection (see
 * `createOverlayWindow`).
 */
async function findSource(target: CaptureTarget): Promise<Electron.DesktopCapturerSource> {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 0, height: 0 }
  })

  const ours = new Set(BrowserWindow.getAllWindows().map((win) => win.getTitle()))
  const windows = sources.filter(
    (source) => source.id.startsWith('window:') && !ours.has(source.name)
  )

  const key = `${target.pid}|${target.exePath}`
  const cached = cachedSource
  if (cached?.key === key) {
    const still = windows.find((source) => source.id === cached.id)
    if (still) return still
  }

  for (const handle of await processWindowHandles(target)) {
    const hit = windows.find((source) => source.id.split(':')[1] === String(handle))
    if (hit) {
      cachedSource = { key, id: hit.id }
      return hit
    }
  }

  // Only then the label, in case the player named the game after its window.
  const wanted = target.title.trim().toLowerCase()
  const exact = windows.find((source) => source.name.trim().toLowerCase() === wanted)
  if (exact) return exact

  const partial = windows.find((source) => {
    const name = source.name.trim().toLowerCase()
    return name.length > 0 && (wanted.includes(name) || name.includes(wanted))
  })
  if (partial) return partial

  const screenSource = sources.find((source) => source.id.startsWith('screen:'))
  if (screenSource) return screenSource

  throw new Error('キャプチャ対象のウィンドウが見つかりませんでした')
}

function getCaptureWindow(): Promise<BrowserWindow> {
  if (captureWindow && !captureWindow.isDestroyed() && windowReady) return windowReady

  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, '../preload/capture.js'),
      sandbox: false,
      // A window that is never shown is throttled to a crawl by default, which
      // would stall MediaRecorder the moment the game takes the foreground.
      backgroundThrottling: false
    }
  })

  captureWindow = win
  windowReady = new Promise<BrowserWindow>((resolve) => {
    ipcMain.once(IpcChannels.CaptureReady, () => resolve(win))
  })

  win.on('closed', () => {
    captureWindow = null
    windowReady = null
  })

  loadRenderer(win, 'capture.html')
  return windowReady
}

/* `Omit` over a union keeps only the keys every member has, which would drop
   the `format` two of the commands carry. Distributing it keeps each member
   whole. */
type CaptureRequest = CaptureCommand extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never

async function send(command: CaptureRequest): Promise<CaptureResultPayload> {
  const win = await getCaptureWindow()
  const id = nextCommandId++
  const answer = new Promise<CaptureResultPayload>((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
  win.webContents.send(IpcChannels.CaptureCommand, { ...command, id } as CaptureCommand)
  return answer
}

/** Opened up front so a chunk can never arrive before its file exists. */
function openWriter(track: CaptureTrack, filePath: string): void {
  void closeWriter(track)
  writers.set(track, {
    stream: fs.createWriteStream(filePath),
    filePath,
    bytes: 0,
    wav: path.extname(filePath).toLowerCase() === '.wav'
  })
}

/** Resolves once the last chunk is on disk, so the file is safe to move. */
async function closeWriter(track: CaptureTrack): Promise<string | null> {
  const writer = writers.get(track)
  if (!writer) return null
  writers.delete(track)
  await new Promise<void>((resolve) => writer.stream.end(resolve))
  if (writer.wav) await patchWavSizes(writer.filePath, writer.bytes)
  return writer.filePath
}

/**
 * Fills in the two lengths a RIFF header carries — everything after the field
 * itself, and the samples on their own. A player that trusts them (Windows
 * Media Player among them) reads a header of zeroes as an empty file.
 */
async function patchWavSizes(filePath: string, bytes: number): Promise<void> {
  if (bytes <= WAV_HEADER_BYTES) return
  const sizes = Buffer.alloc(4)
  const handle = await fs.promises.open(filePath, 'r+').catch(() => null)
  if (!handle) return
  try {
    sizes.writeUInt32LE(bytes - 8, 0)
    await handle.write(sizes, 0, 4, 4)
    sizes.writeUInt32LE(bytes - WAV_HEADER_BYTES, 0)
    await handle.write(sizes, 0, 4, 40)
  } finally {
    await handle.close()
  }
}

/** Everything Windows will not have in a file name. */
function safeName(value: string): string {
  return value.replace(/[\/:*?"<>|]/g, '_').trim() || 'capture'
}

/**
 * Offers the finished capture to the player to name and put where they like.
 * The app's own copy stays where it is either way: closing the dialog should
 * not be a way to lose a recording, and it is the only copy until they say
 * otherwise.
 */
async function offerToSave(
  filePath: string,
  gameTitle: string,
  kind: 'screenshot' | 'video' | 'audio'
): Promise<string | null> {
  const ext = path.extname(filePath)
  const defaultDir = app.getPath(kind === 'screenshot' ? 'pictures' : kind === 'video' ? 'videos' : 'music')
  // The dialog offers whatever the file already is: the format is the Setting
  // board's to choose, and this is only where the finished file is named.
  const suffix = ext.replace(/^\./, '').toLowerCase()
  const filters = [{ name: suffix.toUpperCase(), extensions: [suffix] }]

  const parent = getOverlayWindow()
  const options: Electron.SaveDialogOptions = {
    title: kind === 'screenshot' ? 'スクリーンショットを保存' : kind === 'video' ? '録画を保存' : '録音を保存',
    defaultPath: path.join(defaultDir, `${safeName(gameTitle)}_${path.basename(filePath)}`),
    filters
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  const target = path.extname(result.filePath) ? result.filePath : result.filePath + ext
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  try {
    await fs.promises.rename(filePath, target)
  } catch {
    // A different volume cannot be renamed onto; copy and drop the original.
    await fs.promises.copyFile(filePath, target)
    await fs.promises.unlink(filePath).catch(() => undefined)
  }
  return target
}

export function registerCaptureHandlers(): void {
  /*
   * `audio: 'loopback'` is what the system is playing. Windows offers no way
   * to take one window's audio on its own, so this is as narrow as it gets: it
   * leaves out every external input (microphone, line-in), but not another
   * application that happens to be making noise.
   */
  electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const next = nextDisplayMedia
    nextDisplayMedia = null
    if (!next) {
      callback({})
      return
    }
    // Built up key by key on purpose: an explicit `audio: undefined` is not the
    // same to Electron as leaving the key out, and fails the capture outright.
    const streams: Electron.Streams = { video: next.source }
    if (next.audio) streams.audio = 'loopback'
    callback(streams)
  })

  ipcMain.on(IpcChannels.CaptureChunk, (_event, payload: CaptureChunkPayload) => {
    const writer = writers.get(payload.track)
    if (!writer) return
    const chunk = Buffer.from(payload.data)
    writer.bytes += chunk.length
    writer.stream.write(chunk)
  })

  ipcMain.on(IpcChannels.CaptureResult, (_event, payload: CaptureResultPayload) => {
    const waiting = pending.get(payload.id)
    if (!waiting) return
    pending.delete(payload.id)
    if (payload.error) waiting.reject(new Error(payload.error))
    else waiting.resolve(payload)
  })
}

export function takeScreenshot(
  target: CaptureTarget,
  gameId: number,
  userDataDir: string
): Promise<{ filePath: string; savedTo: string | null }> {
  return serialize(async () => {
    // Read per capture rather than held: a format changed on the Setting board
    // takes on the next shot without the app being restarted.
    const format = getSettings().screenshotFormat
    const source = await findSource(target)
    nextDisplayMedia = { source, audio: false }
    try {
      const result = await send({ kind: 'screenshot', format })
      if (!result.image) throw new Error('スクリーンショットを取得できませんでした')
      const filePath = outputPath(userDataDir, 'screenshots', gameId, format)
      fs.writeFileSync(filePath, Buffer.from(result.image))
      const savedTo = await offerToSave(filePath, target.title, 'screenshot')
      return { filePath: savedTo ?? filePath, savedTo }
    } finally {
      nextDisplayMedia = null
    }
  })
}

export function toggleVideo(
  target: CaptureTarget,
  gameId: number,
  userDataDir: string
): Promise<CaptureToggleResult> {
  return serialize(async () => {
    if (state.video) {
      await send({ kind: 'stop-video' })
      state.video = false
      const filePath = await closeWriter('video')
      const savedTo = filePath ? await offerToSave(filePath, target.title, 'video') : null
      return { state: getCaptureState(), savedTo }
    }

    /*
     * The extension is the Setting board's, the bytes are not: this runtime's
     * MediaRecorder muxes MP4 (H.264 + AAC) and WebM and nothing else, so a
     * .mov holds the same ISO-BMFF stream an .mp4 does. Every reader of the
     * format sniffs the `ftyp` brand rather than the name, so the file opens
     * as a QuickTime movie — but it is not a QuickTime mux, and making one
     * would take a remuxer this app does not carry.
     */
    const source = await findSource(target)
    openWriter('video', outputPath(userDataDir, 'videos', gameId, getSettings().videoFormat))
    nextDisplayMedia = { source, audio: true }
    try {
      await send({ kind: 'start-video' })
      state.video = true
    } catch (error) {
      void closeWriter('video')
      throw error
    } finally {
      nextDisplayMedia = null
    }
    return { state: getCaptureState(), savedTo: null }
  })
}

export function toggleAudio(
  target: CaptureTarget,
  gameId: number,
  userDataDir: string
): Promise<CaptureToggleResult> {
  return serialize(async () => {
    if (state.audio) {
      await send({ kind: 'stop-audio' })
      state.audio = false
      const filePath = await closeWriter('audio')
      const savedTo = filePath ? await offerToSave(filePath, target.title, 'audio') : null
      return { state: getCaptureState(), savedTo }
    }

    // `getDisplayMedia` always hands back a video track, so the game's window
    // is named here too; the worker drops that track straight away.
    const format = getSettings().audioFormat
    const source = await findSource(target)
    openWriter('audio', outputPath(userDataDir, 'audio', gameId, format))
    nextDisplayMedia = { source, audio: true }
    try {
      await send({ kind: 'start-audio', format })
      state.audio = true
    } catch (error) {
      void closeWriter('audio')
      throw error
    } finally {
      nextDisplayMedia = null
    }
    return { state: getCaptureState(), savedTo: null }
  })
}

/** Ends the session's captures, flushing whatever has been recorded so far. */
export async function shutdownCapture(): Promise<void> {
  if (!captureWindow || captureWindow.isDestroyed()) {
    state.video = false
    state.audio = false
    return
  }

  await serialize(async () => {
    // No save dialog here: the session is over and the panel is already on its
    // way out, so whatever was still running is just flushed to its own file.
    if (state.video) {
      await send({ kind: 'stop-video' }).catch(() => undefined)
      state.video = false
      await closeWriter('video')
    }
    if (state.audio) {
      await send({ kind: 'stop-audio' }).catch(() => undefined)
      state.audio = false
      await closeWriter('audio')
    }
  })

  captureWindow?.destroy()
}
