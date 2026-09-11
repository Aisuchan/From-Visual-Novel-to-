import { ipcMain, dialog, app, screen, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import * as db from './db'
import type {
  GameReference,
  HomeLayout,
  NewGroupInput,
  NewRouteInput,
  ProgressState,
  RoutePatch
} from '../shared/db-types'
import { launchGame } from './launcher'
import * as capture from './capture'
import * as reference from './reference'
import {
  createOverlayWindow,
  closeOverlayWindow,
  getLibraryWindow,
  getOverlayWindow,
  setOverlayWidth
} from './windows'
import { listSoundEffects } from './sound-effects'
import { IpcChannels } from '../shared/ipc-types'
import { setLanguage, t } from '../shared/i18n'
import { GALLERY_IMAGE_EXTENSIONS, GALLERY_VIDEO_EXTENSIONS } from '../shared/media-url'
import type { AppSettings, LaunchPrefs, NewGameInput } from '../shared/db-types'
import type { StartSessionRequest } from '../shared/ipc-types'

/**
 * **The PCの起動時にこのアプリを立ち上げる row is the one that writes outside the
 * app.** What it stands for is Windows' own startup list rather than anything
 * in the database, so the row is put onto the machine every time it can have
 * changed: as it is written, when the whole table is reset, and once at
 * startup — the last of those being what puts a restored library's answer back
 * on a machine that never had it.
 */
export function applyLaunchAtLogin(settings: AppSettings): void {
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin === 'on' })
}

/* Every dialog this module puts up belongs to the library window. Unparented,
   Windows is free to put a message box *behind* the app — the press then reads
   as nothing having happened at all, which is what the 設定をリセット row did
   the first time it was tried. `showMessageBox` and `showOpenDialog` take the
   parent as their first argument, and a window that is somehow not there falls
   back to the unparented call rather than throwing. */
function showBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const parent = getLibraryWindow()
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

function showOpen(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  const parent = getLibraryWindow()
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

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
  // Time on a game is time on whichever route was active while it ran. Banked
  // here rather than in the renderer so it lands whether or not the Route board
  // is open — or the library window is even up.
  db.addRoutePlaySeconds(session.gameId, session.durationSeconds)
  // Whatever was still recording is flushed to disk before the worker goes.
  void capture.shutdownCapture()
  closeOverlayWindow()
  getLibraryWindow()?.webContents.send(IpcChannels.SessionEnded, {
    sessionId: session.id,
    gameId: session.gameId,
    durationSeconds: session.durationSeconds
  })
}

/* Files a capture the player kept in the game's own Add Thumbnail gallery, for
   whichever of the two 自動保存 rows asked for it. `saved` is where the save
   dialog put the file — the one copy of it the player chose to keep — and it is
   what `source_path` records; the gallery draws a copy of its own so that it
   owns its files and so that `fvn-media:` can serve them. */
function fileInGallery(gameId: number, saved: string, source: 'screenshot' | 'recording'): void {
  try {
    const destDir = path.join(app.getPath('userData'), 'game-images', String(gameId))
    fs.mkdirSync(destDir, { recursive: true })
    const dest = path.join(destDir, `${randomUUID()}${path.extname(saved)}`)
    fs.copyFileSync(saved, dest)
    db.addGameImages(gameId, [{ filePath: dest, sourcePath: saved }], source)
  } catch {
    // Filing it is a convenience; the capture itself is already saved.
  }
}

/* A launch that could not be made, once the session has already been started.
   The session is ended the way any other is — nothing ran, so it banks the
   nothing it comes to — and the library window is told why, there being no
   call left to throw it back to. */
function reportLaunchFailure(message: string): void {
  finishActiveSession()
  getLibraryWindow()?.webContents.send(IpcChannels.SessionFailed, { message })
}

/** The copy a face was carrying, once it is carrying another one or none. Only
    the copies this app made under its own folder are ours to remove. */
function removeHomeImageFile(
  game: { homeCardImage: string | null; homeSpineImage: string | null } | null,
  face: HomeLayout
): void {
  const previous = face === 'shelf' ? game?.homeSpineImage : game?.homeCardImage
  if (!previous) return
  const owned = path.join(app.getPath('userData'), 'home-images')
  if (path.relative(owned, previous).startsWith('..')) return
  fs.rmSync(previous, { force: true })
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

  ipcMain.handle(
    IpcChannels.GamesSetProgress,
    (_event, gameId: number, state: ProgressState | null, score: number | null) =>
      db.setProgress(gameId, state, score)
  )

  /* The picture one Home face shows for one game. It is picked, copied and
     written in a single call because the copy is not the gallery's: it goes to
     this face's own folder, and the one it replaces is taken off disk with it.
     Nothing here touches `game_images` or `thumbnail_path`, which is what keeps
     the change to the cell it was made on. */
  ipcMain.handle(
    IpcChannels.GamesPickHomeImage,
    async (_event, gameId: number, face: HomeLayout) => {
      const result = await showOpen({
        title: t(face === 'shelf' ? '背表紙の画像を選択' : 'サムネイルの画像を選択'),
        properties: ['openFile'],
        filters: [{ name: t('画像'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const destDir = path.join(app.getPath('userData'), 'home-images', String(gameId))
      fs.mkdirSync(destDir, { recursive: true })
      const src = result.filePaths[0]
      const dest = path.join(destDir, `${randomUUID()}${path.extname(src)}`)
      fs.copyFileSync(src, dest)

      const before = db.getGame(gameId)
      const updated = db.setHomeImage(gameId, face, dest)
      removeHomeImageFile(before, face)
      return updated
    }
  )

  ipcMain.handle(IpcChannels.GamesClearHomeImage, (_event, gameId: number, face: HomeLayout) => {
    const before = db.getGame(gameId)
    const updated = db.setHomeImage(gameId, face, null)
    removeHomeImageFile(before, face)
    return updated
  })

  ipcMain.handle(IpcChannels.GameImagesList, (_event, gameId: number) => db.listGameImages(gameId))

  ipcMain.handle(IpcChannels.RoutesList, (_event, gameId: number) => db.listRoutes(gameId))

  ipcMain.handle(IpcChannels.RoutesAdd, (_event, input: NewRouteInput) => db.addRoute(input))

  ipcMain.handle(
    IpcChannels.RoutesUpdate,
    (_event, gameId: number, routeId: number, patch: RoutePatch) =>
      db.updateRoute(gameId, routeId, patch)
  )

  ipcMain.handle(IpcChannels.RoutesDelete, (_event, gameId: number, routeId: number) =>
    db.deleteRoute(gameId, routeId)
  )

  ipcMain.handle(IpcChannels.RoutesSetActive, (_event, gameId: number, routeId: number | null) =>
    db.setActiveRoute(gameId, routeId)
  )

  ipcMain.handle(IpcChannels.GroupsList, () => db.listGroups())

  ipcMain.handle(IpcChannels.GroupsAdd, (_event, input: NewGroupInput) => db.addGroup(input))

  ipcMain.handle(IpcChannels.TagsList, () => db.listTags())

  ipcMain.handle(IpcChannels.SettingsGet, () => db.getSettings())
  ipcMain.handle(IpcChannels.GroupsUpdate, (_e, id: number, input: NewGroupInput) =>
    db.updateGroup(id, input)
  )

  ipcMain.handle(IpcChannels.GroupsDelete, (_e, id: number) => db.deleteGroup(id))

  ipcMain.handle(IpcChannels.SettingsSet, (_e, patch) => {
    const settings = db.setSettings(patch)
    /* This process writes in the chosen language too, so it follows the row
       rather than being told once at startup. */
    setLanguage(settings.language)
    applyLaunchAtLogin(settings)
    return settings
  })

  /* The Recorder Panel's own row lists a corner of each display, so it needs
     the displays. Answered per call rather than held: one can be plugged in
     or unplugged while the app is running, and the row is read as the board
     opens. */
  ipcMain.handle(IpcChannels.SessionsDelete, (_e, gameId: number, sessionId: number) => {
    db.deleteSession(gameId, sessionId)
  })

  /* Shows a picture where it lives. `showItemInFolder` opens the folder with
     the file already picked out, which is what "open the file's location"
     means on every platform that has one.

     **What a player means by their picture is the file they picked, not the
     app's copy of it.** The gallery draws a copy under `userData` with a UUID
     for a name, in a folder nobody keeps anything in; opening *that* one
     answers a question nobody asked. So the caller names the original first
     and the copy behind it, and the fallback is taken only when the original
     is no longer on disk — which is the one case where the app's copy is all
     that is left of the picture. The existence check is here rather than in
     the page: a renderer has no `fs`. */
  ipcMain.handle(IpcChannels.ShellShowItem, (_e, filePath: string, fallback?: string | null) => {
    const first = filePath ? path.normalize(filePath) : ''
    if (first && fs.existsSync(first)) {
      shell.showItemInFolder(first)
      return
    }
    if (fallback) shell.showItemInFolder(path.normalize(fallback))
  })

  ipcMain.handle(IpcChannels.SoundEffectsList, () => listSoundEffects())

  /* A backup is a dated folder holding `library.sqlite3` beside the pictures,
     so what is picked is that database *inside* it — the restore finds the rest
     by the manifest lying next to it. It stays a file dialog rather than a
     folder one so that a bare `.sqlite3`, which is what every backup made
     before the folders existed is, can still be pointed at. The dialog opens on
     the folder the 起動時にバックアップを作成 row names, which is where they
     are. */
  /* Asked about first, the way the restore below is, and in the main process
     for the same reason it is not worth two: every row goes back at once and
     there is no undoing it. Nothing about the library is touched, which is what
     the question says, and no restart follows — what a row is read for happens
     the next time it is read. */
  ipcMain.handle(IpcChannels.SettingsReset, async () => {
    const answer = await showBox({
      type: 'warning',
      title: t('設定のリセット'),
      message: t('すべての設定を初期状態に戻します'),
      detail: t(
        'ゲーム・プレイ時間・ルート・予定・画像はそのままです。戻るのは設定画面の内容だけで、この操作は元に戻せません。'
      ),
      buttons: [t('リセット'), t('キャンセル')],
      defaultId: 1,
      cancelId: 1
    })
    if (answer.response !== 0) return null
    const settings = db.resetSettings()
    /* The reset puts every row back, and this one stands for something outside
       the app: left alone, the machine would go on starting an app whose board
       says it does not. */
    applyLaunchAtLogin(settings)
    return settings
  })

  ipcMain.handle(IpcChannels.BackupPickFile, async () => {
    const kept = db.getSettings().backupDirectory
    const result = await showOpen({
      title: t('読み込むバックアップを選択（library.sqlite3）'),
      defaultPath: kept && fs.existsSync(kept) ? kept : undefined,
      properties: ['openFile'],
      filters: [
        { name: t('バックアップ'), extensions: ['sqlite3', 'sqlite', 'db'] },
        { name: t('すべてのファイル'), extensions: ['*'] }
      ]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IpcChannels.BackupCheck, (_e, filePath: string) => {
    const target = String(filePath ?? '').trim()
    return target ? db.isBackupFile(target) : false
  })

  /* Reading a backup back is the one thing on the Setting board that cannot
     be undone, so it is asked about first — in the main process, since what
     follows is a restart and there would be nothing left to answer to. */
  ipcMain.handle(IpcChannels.BackupRestore, async (_e, filePath: string) => {
    const target = String(filePath ?? '').trim()
    if (!target || !fs.existsSync(target)) {
      await showBox({
        type: 'error',
        title: t('バックアップの読み込み'),
        message: t('ファイルが見つかりません'),
        detail: target || t('パスが入力されていません')
      })
      return false
    }

    const answer = await showBox({
      type: 'warning',
      title: t('バックアップの読み込み'),
      message: t('今のライブラリをこのバックアップで置き換えます'),
      detail: `${target}\n\nゲーム・プレイ時間・ルート・予定・設定は、このバックアップが作られた時点のものに戻ります。同じフォルダに画像が入っている場合は、サムネイル・ギャラリー・アイコンも一緒に戻ります。この操作は元に戻せません。\n読み込むとアプリを再起動します。`,
      buttons: [t('読み込む'), t('キャンセル')],
      defaultId: 1,
      cancelId: 1
    })
    if (answer.response !== 0) return false

    try {
      db.restoreDatabase(target)
    } catch (error) {
      await showBox({
        type: 'error',
        title: t('バックアップの読み込み'),
        message: t('読み込めませんでした'),
        detail: error instanceof Error ? error.message : String(error)
      })
      return false
    }
    app.relaunch()
    app.exit(0)
    return true
  })

  /* The folder the launch backup goes in. A folder rather than a file: the
     name is the day's, so what the row names is where those days go. */
  ipcMain.handle(IpcChannels.BackupPickDirectory, async () => {
    const result = await showOpen({
      title: t('バックアップの保存先を選択'),
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  /* The desktop's displays as they are right now — this is asked again every
     time the Setting board's own list is dropped, so one plugged in or
     unplugged while the board is open is answered for.

     **A number alone does not say which monitor it is.** Two of the same model
     side by side came out as モニター1 and モニター2 with nothing to tell them
     apart, so the label carries the panel's own resolution as well, and the
     primary says that it is: those are the two things a player can check
     against what is in front of them. The resolution is the physical one
     (`size` is in device-independent pixels, so the scale factor is put back)
     because that is the figure the display settings show. */
  ipcMain.handle(IpcChannels.DisplaysList, () => {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((display, index) => {
      const width = Math.round(display.size.width * display.scaleFactor)
      const height = Math.round(display.size.height * display.scaleFactor)
      const primary = display.id === primaryId
      const short = t('モニター{0}', index + 1)
      return {
        id: String(display.id),
        label: `${short} (${width}×${height}${primary ? t('・メイン') : ''})`,
        short,
        primary
      }
    })
  })

  ipcMain.handle(IpcChannels.SessionsList, (_event, gameId: number) => db.listSessions(gameId))

  ipcMain.handle(IpcChannels.SessionsPlaytimeByDay, (_event, fromDate: string, toDate: string) =>
    db.getPlaytimeByDay(fromDate, toDate)
  )

  ipcMain.handle(
    IpcChannels.SessionsPlaytimeByDayAndGame,
    (_event, fromDate: string, toDate: string) => db.getPlaytimeByDayAndGame(fromDate, toDate)
  )

  ipcMain.handle(IpcChannels.PlansList, (_event, fromDate: string, toDate: string) =>
    db.listPlans(fromDate, toDate)
  )

  ipcMain.handle(IpcChannels.PlansAdd, (_event, input) => db.addPlan(input))

  ipcMain.handle(IpcChannels.PlansUpdate, (_event, planId: number, input) =>
    db.updatePlan(planId, input)
  )

  ipcMain.handle(IpcChannels.PlansDelete, (_event, planId: number) => db.deletePlan(planId))

  /* "ADD IMAGE" in the Add Thumbnail screen. The files are copied under
     userData so the grid keeps working if the originals move or are deleted.

     **The gallery takes clips as well as pictures.** The three filters are the
     two kinds together, then each on its own, so a player looking for one
     among the other can narrow the dialog down themselves. */
  ipcMain.handle(IpcChannels.GameImagesAdd, async (_event, gameId: number) => {
    const result = await showOpen({
      title: t('画像・動画を選択'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: t('画像・動画'),
          extensions: [...GALLERY_IMAGE_EXTENSIONS, ...GALLERY_VIDEO_EXTENSIONS]
        },
        { name: t('画像'), extensions: [...GALLERY_IMAGE_EXTENSIONS] },
        { name: t('動画'), extensions: [...GALLERY_VIDEO_EXTENSIONS] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return db.listGameImages(gameId)

    const destDir = path.join(app.getPath('userData'), 'game-images', String(gameId))
    fs.mkdirSync(destDir, { recursive: true })
    const copied = result.filePaths.map((src) => {
      const dest = path.join(destDir, `${randomUUID()}${path.extname(src)}`)
      fs.copyFileSync(src, dest)
      // The file that was picked is kept beside the copy: it is what the
      // gallery's own 「ファイルの場所を開く」 opens.
      return { filePath: dest, sourcePath: src }
    })
    return db.addGameImages(gameId, copied)
  })

  /* **A page opened in the system's own browser.** Checked here rather than
     trusted from the renderer: `openExternal` hands its argument to the desktop,
     which will act on schemes that are not pages at all, so only http and https
     get through. */
  ipcMain.handle(IpcChannels.ShellOpenExternal, async (_e, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    await shell.openExternal(parsed.href)
  })

  /* The Reference row. Both are one request each and both are paced by the one
     queue in `reference.ts`; nothing here is fired by anything but a press. */
  ipcMain.handle(IpcChannels.ReferencePage, (_event, url: string) =>
    reference.fetchPage(url)
  )

  ipcMain.handle(
    IpcChannels.ReferenceImage,
    (_event, src: string, referer: string) => reference.fetchImage(src, referer)
  )

  ipcMain.handle(
    IpcChannels.GameImagesReorder,
    (_event, gameId: number, orderedIds: number[]) => db.reorderGameImages(gameId, orderedIds)
  )

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

  /* **The file is named for the executable, not for the occasion.** This is
     what the Add Game dialog's 「実行ファイルのアイコンを使う」 previews with,
     so it runs every time that box is ticked, every time the exe is changed and
     every time the dialog is opened on a game that has it on — and with a UUID
     for a name each of those wrote another PNG that nothing ever removed. A
     dialog cancelled left one behind too. One executable has one icon, so the
     name is that path's own digest and the file is simply written again: the
     same exe always lands on the same file, an exe that has been updated
     refreshes it, and two games launched from one executable share it.

     Whatever the old ones left behind is swept at startup — a file no game
     points at (`pruneUnusedIcons`), which is also what clears a deleted game's
     icon and what a cancelled dialog leaves. */
  ipcMain.handle(IpcChannels.GamesExtractExeIcon, async (_event, exePath: string) => {
    try {
      const image = await app.getFileIcon(exePath, { size: 'large' })
      if (image.isEmpty()) return null
      const dir = path.join(app.getPath('userData'), 'icons')
      fs.mkdirSync(dir, { recursive: true })
      const key = createHash('sha1').update(path.resolve(exePath).toLowerCase()).digest('hex')
      const filePath = path.join(dir, `${key}.png`)
      fs.writeFileSync(filePath, image.toPNG())
      return filePath
    } catch {
      return null
    }
  })

  ipcMain.handle(IpcChannels.GamesSetReference, (_e, gameId: number, input: GameReference) =>
    db.setGameReference(gameId, input)
  )

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
    const result = await showOpen({
      title: t('実行ファイルを選択'),
      properties: ['openFile'],
      filters: [{ name: t('実行ファイル'), extensions: ['exe'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.GamesPickImage, async () => {
    const result = await showOpen({
      title: t('画像を選択'),
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
      throw new Error(t('既に別のセッションが進行中です'))
    }
    const game = db.getGame(req.gameId)
    if (!game) throw new Error(t('ゲームが見つかりません'))

    /* The one thing that can be answered before anything is started, and the
       common case by a distance: the file has been moved, renamed or deleted
       since the game was registered. Asked here rather than left to `spawn`,
       so no session row is written for a game that was never launched and the
       caller is told by its own call rather than by a message after the fact. */
    if (!fs.existsSync(game.exePath)) {
      throw new Error(t('実行ファイルが見つかりません。\n{0}', game.exePath))
    }

    const session = db.startSession(game.id, req.recordTime)

    const pid = launchGame(
      game.exePath,
      req.runAsAdmin,
      () => finishActiveSession(),
      (message) => reportLaunchFailure(message)
    )

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
    if (!active) throw new Error(t('進行中のセッションがありません'))
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
    if (!active) throw new Error(t('進行中のセッションがありません'))
    const gameId = active.gameId
    const result = await capture.takeScreenshot(
      captureTarget(active),
      gameId,
      app.getPath('userData')
    )
    /* The Setting board's スクリーンショットの自動保存 row, which is what
       `game_images.source` has always told apart.

       The gallery is given a copy of its own, in `game-images/<id>/` where a
       picture added by hand goes, rather than the path the shot is at. Two
       reasons, and either one is enough: the app's own copy is *moved* to
       wherever the save dialog put it, so that path is outside `userData` —
       and `fvn-media:` serves nothing outside `userData` (see
       `resolveMediaPath`), which is a 404 per cell and a page of empty frames.
       A gallery that owns its files also does not lose one to a player tidying
       up their Pictures folder.

       The library window is not told: the gallery reads its list as it opens,
       and the shot was taken from a game that is being played rather than from
       a board someone is looking at.

       **Only a shot that was actually saved is filed.** Closing the save
       dialog is how a shot is thrown away — the app's own copy stays, but it
       is a copy of something the player decided against, and a gallery is not
       where that belongs. */
    if (result.savedTo && db.getSettings().screenshotToGallery === 'on') {
      fileInGallery(gameId, result.savedTo, 'screenshot')
    }
    return result
  })

  ipcMain.handle(IpcChannels.SessionToggleVideo, async () => {
    if (!active) throw new Error(t('進行中のセッションがありません'))
    const gameId = active.gameId
    const result = await capture.toggleVideo(
      captureTarget(active),
      gameId,
      app.getPath('userData')
    )
    /* The Setting board's 画面録画の自動保存 row — the screenshot row's rule,
       for the recordings the gallery can hold now that it holds clips. Only a
       take that was actually saved is filed, the gallery is given a copy of its
       own under `userData` (the app's own copy has been *moved* to wherever the
       dialog put it, and `fvn-media:` serves nothing outside `userData`), and
       the library window is not told: the gallery reads its list as it opens,
       and this was recorded from a game being played. */
    if (result.savedTo && db.getSettings().videoToGallery === 'on') {
      fileInGallery(gameId, result.savedTo, 'recording')
    }
    broadcastCaptureState()
    return result
  })

  ipcMain.handle(IpcChannels.SessionToggleAudio, async () => {
    if (!active) throw new Error(t('進行中のセッションがありません'))
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
