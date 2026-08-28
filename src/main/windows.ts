import { BrowserWindow, Menu, screen, shell } from 'electron'
import path from 'node:path'
import { is } from './env'
import { IpcChannels } from '../shared/ipc-types'

let libraryWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

/** Exported for the capture worker, which lives outside this module. */
export function loadRenderer(win: BrowserWindow, htmlFile: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${htmlFile}`)
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${htmlFile}`))
  }
}

Menu.setApplicationMenu(null)

export function createLibraryWindow(): BrowserWindow {
  if (libraryWindow) {
    libraryWindow.focus()
    return libraryWindow
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#14171a',
    show: false,
    // No `titleBarOverlay`: Windows enforces a ~31px minimum on the native
    // caption buttons, which is taller than the scaled 36px design header, so
    // they painted over the header's bottom rule. The Header component draws
    // its own buttons and drives them over IPC instead.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/library.js'),
      sandbox: false
    }
  })

  const emitMaximized = (maximized: boolean): void =>
    win.webContents.send(IpcChannels.WindowMaximizedChanged, maximized)
  win.on('maximize', () => emitMaximized(true))
  win.on('unmaximize', () => emitMaximized(false))

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    libraryWindow = null
  })

  loadRenderer(win, 'index.html')
  libraryWindow = win
  return win
}

/* Penpot "Recorder Panel": 225x28 with a 1px outer stroke on every side.
   Shrunk, only the 25px "Strech / Shrink Button" and the 24px "Move Button"
   remain. */
const OVERLAY_WIDTH = 227
const OVERLAY_SHRUNK_WIDTH = 51
const OVERLAY_HEIGHT = 30

/*
 * Windows will not make a transparent window smaller than 64x64 (measured: an
 * opaque one goes down to SM_CYMIN = 39, a transparent one asked for 20, 30,
 * 40, 50 or 60 comes back 64 every time; no combination of `thickFrame`,
 * `type: 'toolbar'`, `useContentSize`, `roundedCorners` or `backgroundColor`
 * moves it). Asking for 51x30 anyway left Electron sizing the page to 51x30
 * inside a window the OS had made 64x64, and the 13px column and 34px band no
 * one painted came back black.
 *
 * So the window is at least the floor and the page is told the truth, and the
 * slack — 34px under the panel, and 13px past it once shrunk — is put where
 * the screen is not: the window is positioned by the panel's own top left
 * corner, so parked in the bottom-right of the desktop the slack hangs off the
 * two edges it is flush against. `.overlay-panel` pulls itself left by
 * `OVERLAY_WIDTH - OVERLAY_SHRUNK_WIDTH` at the floor to keep that true (see
 * the media query in App.css).
 */
const OVERLAY_MIN = 64
const OVERLAY_WINDOW_HEIGHT = Math.max(OVERLAY_HEIGHT, OVERLAY_MIN)

/** The panel's own width, which is not the window's once the floor bites. */
let overlayPanelWidth = OVERLAY_WIDTH

export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow) {
    overlayWindow.show()
    return overlayWindow
  }

  // Flush into the bottom-right corner of the usable desktop (the work area,
  // so the taskbar does not sit on top of it).
  const { workArea } = screen.getPrimaryDisplay()

  const win = new BrowserWindow({
    // Penpot "Recorder Panel" board is 225x28 plus its 1px outer stroke.
    width: OVERLAY_WIDTH,
    height: OVERLAY_WINDOW_HEIGHT,
    // The panel's top left corner, not the window's — the window keeps going
    // for another 34px, off the bottom of the screen.
    x: workArea.x + workArea.width - OVERLAY_WIDTH,
    y: workArea.y + workArea.height - OVERLAY_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/overlay.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  // Keeps the panel out of every capture — this app's own screenshots and
  // recordings included — while leaving it perfectly visible on screen.
  // Windows 10 2004 and later exclude the window outright rather than
  // blacking it out.
  win.setContentProtection(true)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    overlayWindow = null
  })

  loadRenderer(win, 'overlay.html')
  overlayWindow = win
  overlayPanelWidth = OVERLAY_WIDTH
  return win
}

/**
 * Collapses towards the right edge: the panel's right edge stays put while its
 * left one moves, so a panel parked in the bottom-right corner stays in the
 * corner. Read from the current bounds so a panel the user dragged keeps its
 * place.
 *
 * `width` is the panel's width, which the window only matches while it is
 * above the floor; below it the window keeps growing to the right, past the
 * screen edge the panel is flush against.
 *
 * Called once per toggle, not once per frame: the panel is transparent, so
 * the slide alone uncovers the desktop, and the width changes only where the
 * strip has already settled and the resize is invisible.
 */
export function setOverlayWidth(width: number): void {
  const win = overlayWindow
  if (!win) return
  const next = Math.round(Math.min(OVERLAY_WIDTH, Math.max(OVERLAY_SHRUNK_WIDTH, width)))
  if (next === overlayPanelWidth) return
  const { x, y } = win.getBounds()
  const panelRight = x + overlayPanelWidth
  overlayPanelWidth = next
  win.setBounds({
    x: panelRight - next,
    y,
    width: Math.max(OVERLAY_MIN, next),
    height: OVERLAY_WINDOW_HEIGHT
  })
}

export function closeOverlayWindow(): void {
  overlayWindow?.close()
  overlayWindow = null
}

export function getLibraryWindow(): BrowserWindow | null {
  return libraryWindow
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow
}
