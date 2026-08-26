import { BrowserWindow, Menu, shell } from 'electron'
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

export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow) {
    overlayWindow.show()
    return overlayWindow
  }

  const win = new BrowserWindow({
    // Penpot "Recorder Panel" board is 449x56.
    width: 449,
    height: 56,
    x: 40,
    y: 40,
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
