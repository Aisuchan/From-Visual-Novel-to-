import { ipcMain, dialog, app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import * as db from './db'
import { launchGame } from './launcher'
import * as capture from './capture'
import {
  createOverlayWindow,
  closeOverlayWindow,
  getLibraryWindow,
  getOverlayWindow,
  setOverlayWidth
} from './windows'
import { IpcChannels } from '../shared/ipc-types'
import type { LaunchPrefs, NewGameInput } from '../shared/db-types'
import type { StartSessionRequest } from '../shared/ipc-types'

interface ActiveSession {
  sessionId: number
  gameId: number
  gameTitle: string
  /** Both are how a capture finds the game's own window — see `findSource`. */
  exePath: string
  pid: number | null
  startedAtMs: number
  paused: boolean
  pausedAccumMs: number
  pauseStartedAtMs: number | null
  tickTimer: NodeJS.Timeout
}

let active: ActiveSession | null = null

function captureTarget(session: ActiveSession): capture.CaptureTarget {
  return { title: session.gameTitle, exePath: session.exePath, pid: session.pid }
}

function elapsedSeconds(session: ActiveSession): number {
  const now = Date.now()
  const ongoingPauseMs =
    session.paused && session.pauseStartedAtMs ? now - session.pauseStartedAtMs : 0
  const pausedMs = session.pausedAccumMs + ongoingPauseMs
  return Math.max(0, Math.floor((now - session.startedAtMs - pausedMs) / 1000))
}

function broadcastCaptureState(): void {
  getOverlayWindow()?.webContents.send(IpcChannels.OverlayCaptureState, capture.getCaptureState())
}

function broadcastTick(): void {
  if (!active) return
  getOverlayWindow()?.webContents.send(IpcChannels.OverlayTick, {
    sessionId: active.sessionId,
    elapsedSeconds: elapsedSeconds(active),
    paused: active.paused
  })
}

function finishActiveSession(): void {
  if (!active) return
  const finished = active
  clearInterval(finished.tickTimer)
  active = null

  // The Recorder Panel's own elapsed time is what gets banked, so any span the
  // player paused is left out of the game's total play time.
  const session = db.endSession(finished.sessionId, elapsedSeconds(finished))
  // Whatever was still recording is flushed to disk before the worker goes.
  void capture.shutdownCapture()
  closeOverlayWindow()
  getLibraryWindow()?.webContents.send(IpcChannels.SessionEnded, {
    sessionId: session.id,
    gameId: session.gameId,
    durationSeconds: session.durationSeconds
  })
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.GamesList, () => db.listGames())

  ipcMain.handle(IpcChannels.GamesAdd, (_event, input: NewGameInput) => db.addGame(input))

  ipcMain.handle(IpcChannels.GamesUpdate, (_event, gameId: number, input: NewGameInput) =>
    db.updateGame(gameId, input)
  )

  ipcMain.handle(IpcChannels.GamesSetPlayTime, (_event, gameId: number, seconds: number) =>
    db.setTotalPlaySeconds(gameId, seconds)
  )

  ipcMain.handle(IpcChannels.GamesSetThumbnail, (_event, gameId: number, filePath: string) =>
    db.setThumbnail(gameId, filePath)
  )

  ipcMain.handle(IpcChannels.GameImagesList, (_event, gameId: number) => db.listGameImages(gameId))

  // "ADD IMAGE" in the Add Thumbnail screen. The files are copied under
  // userData so the grid keeps working if the originals move or are deleted.
  ipcMain.handle(IpcChannels.GameImagesAdd, async (_event, gameId: number) => {
    const result = await dialog.showOpenDialog({
      title: '画像を選択',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return db.listGameImages(gameId)

    const destDir = path.join(app.getPath('userData'), 'game-images', String(gameId))
    fs.mkdirSync(destDir, { recursive: true })
    const copied = result.filePaths.map((src) => {
      const dest = path.join(destDir, `${randomUUID()}${path.extname(src)}`)
      fs.copyFileSync(src, dest)
      return dest
    })
    return db.addGameImages(gameId, copied)
  })

  ipcMain.handle(IpcChannels.GameImagesDelete, (_event, gameId: number, imageId: number) => {
    const image = db.getGameImage(gameId, imageId)
    const remaining = db.deleteGameImage(gameId, imageId)
    // Only the copies this app made are ours to remove from disk: the gallery's
    // own folder, and the one the Add Game dialog copies a thumbnail into.
    const owned = ['game-images', 'images'].map((dir) => path.join(app.getPath('userData'), dir))
    if (image && owned.some((dir) => !path.relative(dir, image.filePath).startsWith('..'))) {
      fs.rmSync(image.filePath, { force: true })
    }
    return remaining
  })

  ipcMain.handle(IpcChannels.GamesExtractExeIcon, async (_event, exePath: string) => {
    try {
      const image = await app.getFileIcon(exePath, { size: 'large' })
      if (image.isEmpty()) return null
      const dir = path.join(app.getPath('userData'), 'icons')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, `${randomUUID()}.png`)
      fs.writeFileSync(filePath, image.toPNG())
      return filePath
    } catch {
      return null
    }
  })

  ipcMain.handle(IpcChannels.GamesDelete, (_event, gameId: number) => db.deleteGame(gameId))

  ipcMain.handle(IpcChannels.GamesReorder, (_event, orderedIds: number[]) =>
    db.reorderGames(orderedIds)
  )

  ipcMain.handle(IpcChannels.GamesFooterStats, () => db.getFooterStats())

  ipcMain.handle(IpcChannels.LaunchPrefsGet, (_event, gameId: number) => db.getLaunchPrefs(gameId))

  ipcMain.handle(IpcChannels.LaunchPrefsSet, (_event, prefs: LaunchPrefs) =>
    db.setLaunchPrefs(prefs)
  )

  ipcMain.handle(IpcChannels.GamesPickExe, async () => {
    const result = await dialog.showOpenDialog({
      title: '実行ファイルを選択',
      properties: ['openFile'],
      filters: [{ name: '実行ファイル', extensions: ['exe'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.GamesPickImage, async () => {
    const result = await dialog.showOpenDialog({
      title: '画像を選択',
      properties: ['openFile'],
      filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const destDir = path.join(app.getPath('userData'), 'images')
    fs.mkdirSync(destDir, { recursive: true })
    const src = result.filePaths[0]
    const dest = path.join(destDir, `${randomUUID()}${path.extname(src)}`)
    fs.copyFileSync(src, dest)
    return dest
  })

  ipcMain.handle(IpcChannels.SessionStart, (_event, req: StartSessionRequest) => {
    if (active) {
      throw new Error('既に別のセッションが進行中です')
    }
    const game = db.getGame(req.gameId)
    if (!game) throw new Error('ゲームが見つかりません')

    const session = db.startSession(game.id, req.recordTime)

    const pid = launchGame(game.exePath, req.runAsAdmin, () => finishActiveSession())

    active = {
      sessionId: session.id,
      gameId: game.id,
      gameTitle: game.title,
      exePath: game.exePath,
      pid,
      startedAtMs: Date.now(),
      paused: false,
      pausedAccumMs: 0,
      pauseStartedAtMs: null,
      tickTimer: setInterval(broadcastTick, 1000)
    }

    if (req.useRecorderPanel) {
      createOverlayWindow()
    }

    return { sessionId: session.id, gameTitle: game.title }
  })

  ipcMain.handle(IpcChannels.SessionTogglePause, () => {
    if (!active) throw new Error('進行中のセッションがありません')
    if (active.paused) {
      active.pausedAccumMs += active.pauseStartedAtMs ? Date.now() - active.pauseStartedAtMs : 0
      active.pauseStartedAtMs = null
      active.paused = false
    } else {
      active.paused = true
      active.pauseStartedAtMs = Date.now()
    }
    broadcastTick()
    return { paused: active.paused }
  })

  ipcMain.handle(IpcChannels.SessionScreenshot, async () => {
    if (!active) throw new Error('進行中のセッションがありません')
    return capture.takeScreenshot(captureTarget(active), active.gameId, app.getPath('userData'))
  })

  ipcMain.handle(IpcChannels.SessionToggleVideo, async () => {
    if (!active) throw new Error('進行中のセッションがありません')
    const result = await capture.toggleVideo(
      captureTarget(active),
      active.gameId,
      app.getPath('userData')
    )
    broadcastCaptureState()
    return result
  })

  ipcMain.handle(IpcChannels.SessionToggleAudio, async () => {
    if (!active) throw new Error('進行中のセッションがありません')
    const result = await capture.toggleAudio(
      captureTarget(active),
      active.gameId,
      app.getPath('userData')
    )
    broadcastCaptureState()
    return result
  })

  // Driven a frame at a time by the panel's collapse, so the window gives the
  // desktop back exactly as fast as the strip slides off it.
  ipcMain.on(IpcChannels.OverlaySetWidth, (_event, width: number) => {
    setOverlayWidth(width)
  })

  // The library window draws its own title bar buttons (the native overlay
  // can't be made short enough to fit the 36px design header — Windows
  // enforces a ~31px minimum), so it drives them over IPC.
  ipcMain.on(IpcChannels.WindowMinimize, () => {
    getLibraryWindow()?.minimize()
  })

  ipcMain.on(IpcChannels.WindowToggleMaximize, () => {
    const win = getLibraryWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on(IpcChannels.WindowClose, () => {
    getLibraryWindow()?.close()
  })
}
