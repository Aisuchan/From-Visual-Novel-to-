import { BrowserWindow, Menu, screen, shell } from 'electron'
import path from 'node:path'
import { is } from './env'
import { IpcChannels } from '../shared/ipc-types'

let libraryWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

function loadRenderer(win: BrowserWindow, htmlFile: string): void {
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
    height: OVERLAY_HEIGHT,
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
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    overlayWindow = null
  })

  loadRenderer(win, 'overlay.html')
  overlayWindow = win
  return win
}

/**
 * Collapses towards the right edge: that edge stays put while the left one
 * moves, so a panel parked in the bottom-right corner stays in the corner.
 * Read from the current bounds so a panel the user dragged keeps its place.
 */
export function setOverlayShrunk(shrunk: boolean): void {
  const win = overlayWindow
  if (!win) return
  const { x, y, width } = win.getBounds()
  const nextWidth = shrunk ? OVERLAY_SHRUNK_WIDTH : OVERLAY_WIDTH
  win.setBounds({ x: x + width - nextWidth, y, width: nextWidth, height: OVERLAY_HEIGHT })
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
