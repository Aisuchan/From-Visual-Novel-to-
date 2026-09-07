import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  session as electronSession
} from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getSettings, setSettings } from './db'
import { getOverlayWindow, loadRenderer } from './windows'
import { IpcChannels } from '../shared/ipc-types'
import { t } from '../shared/i18n'
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

/*
 * **The three folders a capture is written to before it is saved anywhere.**
 * A recording is appended to a file on disk chunk by chunk and a shot is
 * written before the dialog is put up, so the file has to exist somewhere
 * first; saving `rename`s it to wherever the player chose, and nothing is left
 * behind. What *is* left behind is a capture whose save dialog was closed — the
 * app keeps that copy rather than throwing away what was just taken.
 *
 * So they fill with exactly one thing: captures nobody saved. A day is how long
 * one is kept — long enough to go back for a shot closed by mistake, short
 * enough that a folder nothing points into does not grow forever. Swept once,
 * as the app starts, when nothing can be recording into them.
 */
const SCRATCH_DIRS = ['screenshots', 'videos', 'audio']
const SCRATCH_TTL_MS = 24 * 60 * 60 * 1000

export function pruneCaptureScratch(userDataDir: string): void {
  const now = Date.now()
  for (const folder of SCRATCH_DIRS) {
    const root = path.join(userDataDir, folder)
    let games: string[]
    try {
      games = fs.readdirSync(root)
    } catch {
      // The folder is only made when a capture is taken; there may be none.
      continue
    }
    for (const game of games) {
      const dir = path.join(root, game)
      try {
        for (const name of fs.readdirSync(dir)) {
          const file = path.join(dir, name)
          if (now - fs.statSync(file).mtimeMs > SCRATCH_TTL_MS) fs.rmSync(file, { force: true })
        }
        // A game's folder with nothing left in it says nothing.
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
      } catch {
        // A file that will not go is a file that stays; this is housekeeping.
      }
    }
  }
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

/** JPEG quality, which is only asked for when the Setting board says jpg. */
const JPEG_QUALITY = 92

/**
 * What each source's own pixels come to, which is what a thumbnail has to be
 * asked for by name: `getSources` scales its thumbnail to *fit* the box it is
 * given, upwards as readily as down — measured, a 1920x1080 screen asked for
 * 3840x2160 came back 3840x2160, and a 1266x776 window asked for the same came
 * back 3817x2160. Ask for the window's own size and the frame is handed over
 * untouched.
 *
 * Cached per source: a game's window does not change size while it is being
 * played, and finding out costs a PowerShell of its own (measured: 532ms).
 */
const sourceSizes = new Map<string, { width: number; height: number }>()

/**
 * `GetWindowRect` through PowerShell, the way `MainWindowHandle` already is.
 * There is no way to ask Electron how big a `desktopCapturer` source is.
 */
function windowSize(handle: number): Promise<{ width: number; height: number } | null> {
  const script =
    `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
    ` public struct R { public int L,T,Rt,B; }` +
    ` public class W { [DllImport("user32.dll")] public static extern bool` +
    ` GetWindowRect(IntPtr h, out R r); }';` +
    ` $r = New-Object R; [void][W]::GetWindowRect([IntPtr]${handle}, [ref]$r);` +
    ` "$($r.Rt - $r.L) $($r.B - $r.T)"`

  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const [width, height] = String(stdout).trim().split(/\s+/).map(Number)
        const sane = (value: number): boolean => Number.isFinite(value) && value > 0
        resolve(sane(width) && sane(height) ? { width, height } : null)
      }
    )
  })
}

/** A source's own size, or the primary display's — a shot scaled a little is
    better than no shot, and the aspect ratio is the capturer's to keep. */
async function sourceSize(
  source: Electron.DesktopCapturerSource
): Promise<{ width: number; height: number }> {
  const cached = sourceSizes.get(source.id)
  if (cached) return cached

  const [kind, id] = source.id.split(':')
  let size: { width: number; height: number } | null = null
  if (kind === 'screen') {
    // A screen source is named by its index into the display list.
    const display = screen.getAllDisplays()[Number(id)]
    if (display) {
      size = {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor)
      }
    }
  } else {
    size = await windowSize(Number(id))
  }

  const answer = size ?? screen.getPrimaryDisplay().size
  sourceSizes.set(source.id, answer)
  return answer
}

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

  throw new Error(t('キャプチャ対象のウィンドウが見つかりませんでした'))
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
/** Which setting holds where this kind of capture was last saved. */
const LAST_SAVE_KEY = {
  screenshot: 'lastSaveScreenshot',
  video: 'lastSaveVideo',
  audio: 'lastSaveAudio'
} as const

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

  /* The dialog opens on the file this kind of capture was last saved as, which
     is what puts it back in the folder the player keeps them in. Each kind
     remembers its own — screenshots and recordings rarely live together — and
     the first one of each still opens on the system folder for it. */
  const lastSaved = getSettings()[LAST_SAVE_KEY[kind]]

  const parent = getOverlayWindow()

  /* A recording's effect sound is played here rather than when this resolves:
     the recorder has stopped and the file is closed by now, so the sound lands
     after the last byte rather than in it, and it is heard as the dialog
     arrives rather than once it has been answered. A screenshot's own sound is
     on the press, the shutter being the sound of the button. */
  if (kind !== 'screenshot') {
    parent?.webContents.send(IpcChannels.OverlayPlayRecordEffect, kind)
  }

  const options: Electron.SaveDialogOptions = {
    title: t(
      kind === 'screenshot' ? 'スクリーンショットを保存' : kind === 'video' ? '録画を保存' : '録音を保存'
    ),
    defaultPath:
      lastSaved || path.join(defaultDir, `${safeName(gameTitle)}_${path.basename(filePath)}`),
    filters
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  const target = path.extname(result.filePath) ? result.filePath : result.filePath + ext
  setSettings({ [LAST_SAVE_KEY[kind]]: target })
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

/**
 * A shot of the game's window, taken here rather than in the capture worker.
 *
 * **`getDisplayMedia` composites the mouse pointer into every frame**, so a
 * shot taken while the mouse was over the game had a pointer painted into the
 * picture, and there is no constraint that reliably turns it off. A
 * `desktopCapturer` thumbnail has no pointer in it — measured end to end: the
 * cursor was put at the exact middle of a 1280x720 window, that window was
 * captured at its own size, and the middle of the picture came back with
 * nothing on it. So the shot is that thumbnail, asked for at the window's own
 * pixel size and encoded here.
 *
 * A recording still goes through the worker and still keeps the pointer: what
 * it is a recording *of* usually includes where the player was pointing.
 */
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
    const size = await sourceSize(source)

    /* Asked for again rather than kept from `findSource`: that call takes no
       thumbnail at all (0x0), which is what keeps finding a window cheap. */
    const shot = await desktopCapturer.getSources({
      types: source.id.startsWith('screen:') ? ['screen'] : ['window'],
      thumbnailSize: size
    })
    const picture = shot.find((entry) => entry.id === source.id)?.thumbnail
    if (!picture || picture.isEmpty()) {
      throw new Error(t('スクリーンショットを取得できませんでした'))
    }

    const filePath = outputPath(userDataDir, 'screenshots', gameId, format)
    fs.writeFileSync(filePath, format === 'jpg' ? picture.toJPEG(JPEG_QUALITY) : picture.toPNG())
    const savedTo = await offerToSave(filePath, target.title, 'screenshot')
    return { filePath: savedTo ?? filePath, savedTo }
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
