import { BrowserWindow, Menu, screen, shell } from 'electron'
import path from 'node:path'
import { is } from './env'
import { getSettings } from './db'
import { soundEffectFile } from './sound-effects'
import { IpcChannels } from '../shared/ipc-types'
import { OVERLAY_SCALES } from '../shared/db-types'
/* The app's own mark, for the taskbar and the Alt-Tab list. `?asset` has the
   bundler copy the file beside the main bundle and hand back its path, so the
   same line answers in dev and in the packaged app; the installer's and the
   exe's icon are `build/icon.ico`, cut from the same picture. */
import appIcon from '../renderer/assets/icon_gen_ring.png?asset'

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
    // 16:9, so the 1920x1080 Penpot layout maps one-to-one at startup and
    // nothing has to stretch (only height flexes -- see useUiScale.ts). The
    // shape is then held there by `setAspectRatio` below, so the minimum is
    // 16:9 too: a 960x600 floor would fight the ratio, which would have to
    // widen the window to 1066 to satisfy it.
    width: 1280,
    height: 720,
    /* The Setting board's 起動時のウインドウサイズ row. Full screen keeps the
       ratio too: it lands on the work area, which is 16:9 whenever the
       display is, and the shell scales by width either way. */
    fullscreen: getSettings().launchWindowMode === 'fullscreen',
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#14171a',
    icon: appIcon,
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

  /* `useUiScale` scales the shell by width alone, so the design pixels a
     window shows vertically are `innerHeight * 1920 / innerWidth`: only a 16:9
     window gives the design's own 1080, and the Middle row has just 4 of them
     to spare before the image band is clipped. Holding the ratio while the
     user drags keeps every window size an exact scale of the design. Maximize
     is the OS's own sizing and is not covered by this -- it lands on the work
     area, which is 16:9 whenever the display is. */
  win.setAspectRatio(16 / 9)

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
 * So the window is at least the floor in both axes and the page is told the
 * truth. What is left over — 34px of height always, and 13px of width once
 * shrunk — is not hidden: it is cut off the window with `setShape`, which is
 * the region the system permits drawing and mouse events inside. Outside it
 * nothing is painted and every press falls through to whatever is behind.
 *
 * That replaces an earlier arrangement which put the slack "where the screen
 * is not" — the window was positioned by the panel's own top left corner, so
 * parked in the bottom-right of the desktop the slack hung off the two edges
 * it was flush against. That bet the slack's invisibility on the window being
 * allowed off the screen, and it came back: the 34px band under the panel and
 * the 13px column past it were both on screen and both black.
 */
const OVERLAY_MIN = 64

/*
 * The Setting board's レコーダーパネルのサイズ row. The page keeps the design's
 * own figures and is scaled as a whole — the library window's own arrangement —
 * so everything the main process measures in panel pixels is scaled by the same
 * factor here, and the page goes on sending and receiving the design's numbers.
 * Read once, as the window is made: the panel's size is not something to change
 * under a recording that is running.
 */
let overlayScale = 1
const panelWidth = (): number => Math.round(OVERLAY_WIDTH * overlayScale)
const panelHeight = (): number => Math.round(OVERLAY_HEIGHT * overlayScale)
const panelShrunkWidth = (): number => Math.round(OVERLAY_SHRUNK_WIDTH * overlayScale)
/** The floor still bites at every size: 30 x 1.25 is 38, well under Windows' 64. */
const windowHeight = (): number => Math.max(panelHeight(), OVERLAY_MIN)

/** The panel's own width, which is not the window's once the floor bites. */
let overlayPanelWidth = OVERLAY_WIDTH

/*
 * Which corner of the window the panel is put in, which is the corner of the
 * display it was opened in: the slack goes to the other two sides. Held here
 * rather than read per call, because it is the panel's *initial* position —
 * the Move Button drags the window anywhere afterwards, and the panel stays
 * in the same corner of it.
 */
let overlaySide: 'left' | 'right' = 'right'
let overlayTop = false

/**
 * Clips the window to the panel, which sits in the corner of it the panel was
 * opened in: the slack is on the other two sides — above or below it always,
 * and beside it once shrunk.
 *
 * The region is in window coordinates and does not follow a resize, so this
 * has to be applied again after every `setBounds`.
 */
function applyOverlayShape(win: BrowserWindow, width: number): void {
  const windowWidth = Math.max(OVERLAY_MIN, width)
  win.setShape([
    {
      x: overlaySide === 'right' ? windowWidth - width : 0,
      y: overlayTop ? 0 : windowHeight() - panelHeight(),
      width,
      height: panelHeight()
    }
  ])
}

/**
 * The display the Setting board's row names, or the primary one — which is
 * also where a display that has since been unplugged comes back to, rather
 * than opening the panel on a desktop that is no longer there.
 */
function overlayDisplay(id: string): Electron.Display {
  if (id === 'primary') return screen.getPrimaryDisplay()
  const named = screen.getAllDisplays().find((display) => String(display.id) === id)
  return named ?? screen.getPrimaryDisplay()
}

/** Whether a remembered point still lands on a connected display, so a panel is
    never restored to where a since-unplugged screen was. */
function pointOnScreen(p: { x: number; y: number }): boolean {
  return screen.getAllDisplays().some(
    (d) =>
      p.x >= d.bounds.x &&
      p.x <= d.bounds.x + d.bounds.width &&
      p.y >= d.bounds.y &&
      p.y <= d.bounds.y + d.bounds.height
  )
}

export function createOverlayWindow(savedOrigin?: { x: number; y: number } | null): BrowserWindow {
  if (overlayWindow) {
    overlayWindow.show()
    return overlayWindow
  }

  /* Flush into the corner the Setting board names, of the display it names, of
     the usable desktop (the work area, so the taskbar does not sit on top of
     it). The window is wholly inside it — the panel is in the window's own
     corner of the same name, and the slack on the other two sides is shaped
     away rather than pushed off the screen.

     `savedOrigin`, where the game left the panel last time, overrides that: it
     is the panel's own top-left on screen — the expanded panel's, so which way
     it was folded or facing does not matter — and the window is placed so the
     panel opens there. A point no longer on any screen is dropped to the default. */
  const settings = getSettings()
  overlayScale = OVERLAY_SCALES[settings.overlaySize]
  overlayPanelWidth = panelWidth()
  const corner = settings.overlayCorner
  overlaySide = corner.endsWith('left') ? 'left' : 'right'
  overlayTop = corner.startsWith('top')
  const { workArea } = overlayDisplay(settings.overlayDisplay)

  /* The panel fills the window at full width, so its top-left is the window's
     left; vertically the window carries its slack on the side away from the
     corner, which is added back to reach the window's own top. */
  const useSaved = savedOrigin != null && pointOnScreen(savedOrigin)
  const posX = useSaved
    ? savedOrigin.x
    : overlaySide === 'right'
      ? workArea.x + workArea.width - panelWidth()
      : workArea.x
  const posY = useSaved
    ? overlayTop
      ? savedOrigin.y
      : savedOrigin.y - (windowHeight() - panelHeight())
    : overlayTop
      ? workArea.y
      : workArea.y + workArea.height - windowHeight()

  const win = new BrowserWindow({
    // Penpot "Recorder Panel" board is 225x28 plus its 1px outer stroke; the
    // height is the floor, the panel taking 30 of it at the corner's own end.
    width: panelWidth(),
    height: windowHeight(),
    x: posX,
    y: posY,
    frame: false,
    transparent: true,
    // A frameless transparent panel has nothing to cast one, and a shadow is
    // drawn outside the shape where it would read as an edge on the slack.
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/overlay.js'),
      sandbox: false,
      /* The page has to know which way round to draw itself on its very first
         frame — a left-hand corner turns the panel around — so the corner
         comes in on the command line rather than over IPC, where the answer
         would arrive a frame or two after the panel had been painted. */
      additionalArguments: [
        '--overlay-corner=' + corner,
        '--overlay-animate=' + settings.animations,
        /* The stored number is resolved to a file here rather than in the
           page: the folder is the main process's to read, and the page is
           handed the one thing it needs. */
        '--overlay-shot-se=' + (soundEffectFile(settings.screenshotSound) ?? ''),
        '--overlay-video-se=' + (soundEffectFile(settings.videoSound) ?? ''),
        '--overlay-audio-se=' + (soundEffectFile(settings.audioSound) ?? ''),
        /* The page is drawn at the design's own figures and scaled as a whole,
           so this is the one number it needs about its size. */
        '--overlay-scale=' + String(overlayScale),
        /* The 言語/language row. On the command line with the rest for the same
           reason: the panel's own runs have to be right on its first frame. */
        '--overlay-language=' + settings.language
      ]
    }
  })

  applyOverlayShape(win, panelWidth())
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
  overlayPanelWidth = panelWidth()
  return win
}

/**
 * Collapses towards the corner the panel is in: the panel's outer edge is the
 * window's outer edge, so holding the window's keeps a panel parked in a
 * corner in it. Read from the current bounds so a panel the user dragged
 * keeps its place.
 *
 * `width` is the panel's width **in the design's own pixels** — the page has no
 * idea what size it is being drawn at — so it is scaled here, and the window
 * only matches it while it is above the floor; below that the window keeps its
 * 64 and the shape moves in from the other side instead.
 *
 * Called once per frame while the panel folds, so the window and the shape
 * clipped out of it travel with the strip rather than catching up with it
 * once it has stopped. That is only safe because the page is anchored to the
 * same edge this holds — so a resize landing a frame late moves nothing that
 * is drawn. Anchored to the moving edge, as it was, the Move Button rode it
 * and jittered between the two clocks.
 */
export function setOverlayWidth(width: number): void {
  const win = overlayWindow
  if (!win) return
  const next = Math.round(
    Math.min(panelWidth(), Math.max(panelShrunkWidth(), width * overlayScale))
  )
  if (next === overlayPanelWidth) return
  const bounds = win.getBounds()
  const nextWidth = Math.max(OVERLAY_MIN, next)
  overlayPanelWidth = next
  win.setBounds({
    x: overlaySide === 'right' ? bounds.x + bounds.width - nextWidth : bounds.x,
    y: bounds.y,
    width: nextWidth,
    height: windowHeight()
  })
  applyOverlayShape(win, next)
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

/** The panel's own top-left on screen — the expanded panel's, so it is the same
    point whichever way the panel is folded or facing — read off the live window.
    Saved as a game's play ends so the next play brings the panel back to it.
    Null when there is no panel. */
export function getOverlayPanelOrigin(): { x: number; y: number } | null {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return null
  const b = win.getBounds()
  return {
    // The fold holds the panel's fixed edge, so the expanded panel runs to
    // panelWidth() from it: from the right edge on a right panel, the left edge
    // on a left one.
    x: overlaySide === 'right' ? b.x + b.width - panelWidth() : b.x,
    y: overlayTop ? b.y : b.y + b.height - panelHeight()
  }
}

/** Turns the panel around — right-facing to left and back — on a double-click of
    its Move Button. The panel stays put on screen: its visible box is held while
    the fixed edge (which the fold holds and the shape sits against) moves to the
    other side, so only the way it folds and where the Move Button sits change.
    Returns the new side, for the renderer that asked to draw itself to match. */
export function flipOverlaySide(): 'left' | 'right' | null {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return null
  const b = win.getBounds()
  const panelLeft = b.x + (overlaySide === 'right' ? b.width - overlayPanelWidth : 0)
  overlaySide = overlaySide === 'right' ? 'left' : 'right'
  const nextShapeX = overlaySide === 'right' ? b.width - overlayPanelWidth : 0
  win.setBounds({ x: Math.round(panelLeft - nextShapeX), y: b.y, width: b.width, height: b.height })
  applyOverlayShape(win, overlayPanelWidth)
  return overlaySide
}

/* The panel is dragged by its Move Button, which the renderer moves the window
   for rather than the OS: a transparent window's own drag region is handled
   inside Chromium and swallows every event, so a double-click on it never
   reaches the page. Made an ordinary (no-drag) element, the button keeps the
   double-click and the move is done here, from the pointer's screen position
   the page reports — the grab offset held from the press so the window follows
   the pointer with the same point under it. `setPosition` carries the window's
   shape with it, so nothing is re-clipped. */
let overlayDragOffset = { x: 0, y: 0 }
export function overlayDragStart(mouseX: number, mouseY: number): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  overlayDragOffset = { x: b.x - mouseX, y: b.y - mouseY }
}
export function overlayDragMove(mouseX: number, mouseY: number): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  win.setPosition(Math.round(mouseX + overlayDragOffset.x), Math.round(mouseY + overlayDragOffset.y))
}

/** Put the panel back at the top of the z-order. A game taking the whole screen
    — a fullscreen one above all — can push an always-on-top window below itself
    and leave it there, so the panel is never seen; re-asserted each tick of a
    session, it climbs back over a borderless- or windowed-fullscreen game. A
    game in true exclusive fullscreen bypasses the window compositor and can be
    drawn over by no window at all, so this cannot answer that one. `moveTop`
    changes the z-order without taking focus, so it never pulls the player out of
    the game. */
export function keepOverlayOnTop(): void {
  const win = overlayWindow
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.moveTop()
}
