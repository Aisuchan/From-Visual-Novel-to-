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
  NewVoiceInput,
  VoicePatch,
  NewLedgerEntryInput,
  ProgressState,
  RoutePatch
} from '../shared/db-types'
import { launchGame } from './launcher'
import * as capture from './capture'
import * as reference from './reference'
import {
  createOverlayWindow,
  closeOverlayWindow,
  flipOverlaySide,
  getLibraryWindow,
  getOverlayPanelOrigin,
  getOverlayWindow,
  keepOverlayOnTop,
  overlayDragMove,
  overlayDragStart,
  setOverlayWidth
} from './windows'
import { listSoundEffects } from './sound-effects'
import { IpcChannels } from '../shared/ipc-types'
import { setLanguage, t } from '../shared/i18n'
import {
  GALLERY_IMAGE_EXTENSIONS,
  GALLERY_VIDEO_EXTENSIONS,
  VOICE_AUDIO_EXTENSIONS
} from '../shared/media-url'
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
  /* A fullscreen game can steal the top of the z-order from the panel and leave
     it hidden; re-asserting it each second climbs it back over a borderless- or
     windowed-fullscreen game (an exclusive-fullscreen one it cannot answer). */
  keepOverlayOnTop()
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
  // Where the panel was left is remembered against the game, so its next play
  // brings it back there — read before the window is closed, and only while the
  // Setting board's row for it is on.
  if (db.getSettings().rememberPanelPosition === 'on') {
    const origin = getOverlayPanelOrigin()
    if (origin) db.setPanelPosition(finished.gameId, origin.x, origin.y)
  }
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

  ipcMain.handle(
    IpcChannels.GamesSetPlayTime,
    (_event, gameId: number, seconds: number, asPlayed: boolean) =>
      db.setTotalPlaySeconds(gameId, seconds, asPlayed === true)
  )

  ipcMain.handle(
    IpcChannels.GamesSetThumbnail,
    (_event, gameId: number, filePath: string | null) => db.setThumbnail(gameId, filePath)
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
  ipcMain.handle(IpcChannels.GameImagesRandom, (_event, r18Only: boolean) =>
    db.getRandomImage(r18Only === true)
  )
  ipcMain.handle(
    IpcChannels.GameImagesSetR18,
    (_event, gameId: number, imageId: number, r18: boolean) =>
      db.setGameImageR18(gameId, imageId, r18 === true)
  )

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

  /* The Voice board and its Add Voice dialog. The Ref button only *picks* the
     file — the copy under `userData` is made as the voice is written, so a
     dialog cancelled leaves nothing behind, the way the Add Game dialog's
     tags do. The filter is audio and the clips the gallery already plays,
     which is what "音声・動画ファイルのみ" comes to in this runtime. */
  ipcMain.handle(IpcChannels.VoicesList, () => db.listVoices())
  ipcMain.handle(IpcChannels.VoicesPickFile, async () => {
    const result = await showOpen({
      title: t('音声・動画を選択'),
      properties: ['openFile'],
      filters: [
        {
          name: t('音声・動画'),
          extensions: [...VOICE_AUDIO_EXTENSIONS, ...GALLERY_VIDEO_EXTENSIONS]
        },
        { name: t('音声'), extensions: [...VOICE_AUDIO_EXTENSIONS] },
        { name: t('動画'), extensions: [...GALLERY_VIDEO_EXTENSIONS] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  /* The copy under `userData` that a voice is played from. Checked here
     rather than trusted from the renderer: a path that is not something this
     runtime plays is refused before anything is copied. */
  const copyVoiceFile = (sourcePath: string): string => {
    const ext = path.extname(sourcePath).slice(1).toLowerCase()
    if (![...VOICE_AUDIO_EXTENSIONS, ...GALLERY_VIDEO_EXTENSIONS].includes(ext)) {
      throw new Error(t('音声・動画ファイルではありません'))
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(t('ファイルが見つかりません。\n{0}', sourcePath))
    }
    const destDir = path.join(app.getPath('userData'), 'voices')
    fs.mkdirSync(destDir, { recursive: true })
    const dest = path.join(destDir, `${randomUUID()}${path.extname(sourcePath)}`)
    fs.copyFileSync(sourcePath, dest)
    return dest
  }
  const ownVoiceFile = (filePath: string): boolean =>
    !path.relative(path.join(app.getPath('userData'), 'voices'), filePath).startsWith('..')
  ipcMain.handle(IpcChannels.VoicesAdd, (_event, input: NewVoiceInput) =>
    db.addVoice({
      gameId: input.gameId,
      characterId: input.characterId,
      title: input.title,
      filePath: copyVoiceFile(input.sourcePath),
      sourcePath: input.sourcePath
    })
  )
  /* 「情報を変更」. A new file is copied in first and the old copy removed
     only once the row points at the new one. */
  ipcMain.handle(IpcChannels.VoicesUpdate, (_event, id: number, patch: VoicePatch) => {
    const before = db.getVoice(id)
    if (!before) return db.listVoices()
    const filePath = patch.sourcePath ? copyVoiceFile(patch.sourcePath) : undefined
    const list = db.updateVoice(id, { ...patch, filePath })
    if (filePath && ownVoiceFile(before.filePath)) fs.rmSync(before.filePath, { force: true })
    return list
  })
  /* The file goes with the row: it is the app's own copy under `userData`,
     which nothing else points at. */
  ipcMain.handle(IpcChannels.VoicesDelete, (_event, id: number) => {
    const voice = db.getVoice(id)
    const remaining = db.deleteVoice(id)
    if (voice && ownVoiceFile(voice.filePath)) fs.rmSync(voice.filePath, { force: true })
    return remaining
  })
  ipcMain.handle(IpcChannels.VoiceCharactersList, () => db.listVoiceCharacters())
  ipcMain.handle(IpcChannels.VoiceCharactersAdd, (_e, name: string) =>
    db.addVoiceCharacter(name)
  )
  ipcMain.handle(IpcChannels.VoiceCharactersRename, (_e, id: number, name: string) =>
    db.renameVoiceCharacter(id, name)
  )
  ipcMain.handle(IpcChannels.VoiceCharactersDelete, (_e, id: number) =>
    db.deleteVoiceCharacter(id)
  )

  ipcMain.handle(IpcChannels.LedgerList, () => db.listLedgerEntries())
  ipcMain.handle(IpcChannels.LedgerAdd, (_event, input: NewLedgerEntryInput) =>
    db.addLedgerEntry(input)
  )
  ipcMain.handle(IpcChannels.LedgerDelete, (_event, id: number) => db.deleteLedgerEntry(id))

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

  /* The 初期化 row: the whole library goes, and only the backups stay. It is
     asked about *twice*, the second question naming what the first was agreed
     to — one press on a red button is a slip, and there is no backup being
     read back here to undo it with. Nothing is touched while a game is being
     played: the capture worker may be writing into the very folders that go,
     and the session's own row would be banked into a database that is gone. */
  ipcMain.handle(IpcChannels.LibraryErase, async () => {
    if (active) {
      await showBox({
        type: 'error',
        title: t('初期化'),
        message: t('ゲームのプレイ中は初期化できません'),
        detail: t('ゲームを終了してからもう一度お試しください。')
      })
      return false
    }

    /* The one promise the row makes is that the backups stay, and a backup
       folder put *inside* `userData` would go with everything else. Refused
       rather than worked around: the row cannot keep its word there, and
       moving the folder is the player's to do. The comparison is on the
       resolved paths, case-folded the way Windows folds them. */
    const backupDir = db.getSettings().backupDirectory.trim()
    if (backupDir) {
      const root = path.resolve(app.getPath('userData')).toLowerCase()
      const kept = path.resolve(backupDir).toLowerCase()
      if (kept === root || kept.startsWith(root + path.sep)) {
        await showBox({
          type: 'error',
          title: t('初期化'),
          message: t('バックアップの保存先がアプリのデータフォルダの中にあります'),
          detail: t(
            '初期化するとバックアップも一緒に消えてしまいます。バックアップの保存先を別の場所に変更してからもう一度お試しください。\n{0}',
            backupDir
          )
        })
        return false
      }
    }

    const first = await showBox({
      type: 'warning',
      title: t('初期化'),
      message: t('バックアップを除くすべてのデータを消去します'),
      detail: t(
        'ゲーム・プレイ時間・ルート・予定・画像・設定がすべて消え、アプリは空の状態で再起動します。バックアップフォルダの中身はそのまま残ります。'
      ),
      buttons: [t('消去'), t('キャンセル')],
      defaultId: 1,
      cancelId: 1
    })
    if (first.response !== 0) return false

    const second = await showBox({
      type: 'warning',
      title: t('初期化'),
      message: t('本当に消去しますか？'),
      detail: t('この操作は元に戻せません。消去したデータは、バックアップからしか戻せません。'),
      buttons: [t('消去する'), t('キャンセル')],
      defaultId: 1,
      cancelId: 1
    })
    if (second.response !== 0) return false

    try {
      db.eraseLibrary()
    } catch (error) {
      await showBox({
        type: 'error',
        title: t('初期化'),
        message: t('消去できませんでした'),
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

  /* Writes the CSV export to a dated file in the chosen directory. The renderer
     builds the rows (it has the games and can read the ledger and routes); this
     only puts the bytes on disk, with a UTF-8 BOM so Excel reads the Japanese. */
  ipcMain.handle(IpcChannels.CsvExport, async (_event, directory: string, content: string) => {
    if (!directory || !fs.existsSync(directory)) {
      throw new Error(t('保存先のフォルダが見つかりません'))
    }
    const now = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
    const filePath = path.join(directory, `VN_Library_${stamp}.csv`)
    fs.writeFileSync(filePath, '﻿' + content, 'utf8')
    return filePath
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
  ipcMain.handle(IpcChannels.PlayAdjustmentsList, (_event, gameId: number) =>
    db.listPlayAdjustments(gameId)
  )
  ipcMain.handle(
    IpcChannels.PlayAdjustmentsDelete,
    (_event, gameId: number, adjustmentId: number) => {
      db.deletePlayAdjustment(gameId, adjustmentId)
    }
  )

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

  ipcMain.handle(IpcChannels.GamesPickImage, async (_event, includeIco?: boolean) => {
    // The icon slot can take a .ico as well as the picture formats; a thumbnail
    // is a cover shown large, so it does not.
    const extensions = ['png', 'jpg', 'jpeg', 'webp', ...(includeIco ? ['ico'] : [])]
    const result = await showOpen({
      title: t('画像を選択'),
      properties: ['openFile'],
      filters: [{ name: t('画像'), extensions }]
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
      // Bring the panel back to where this game left it last time, if anywhere
      // and if the Setting board's row for it is on.
      const saved =
        db.getSettings().rememberPanelPosition === 'on' ? db.getPanelPosition(game.id) : null
      createOverlayWindow(saved)
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
    const gameId = active.gameId
    const result = await capture.toggleAudio(captureTarget(active), gameId, app.getPath('userData'))
    /* The Setting board's 録音の自動保存 row: a recording the player saved is
       filed in the Voice Manager under the game the session was for. Its title
       is the saved file's own name and its source is where the player put it;
       the copy this makes under userData is what `fvn-media:` plays and what it
       falls back to if that file is later gone — the shape a voice added by hand
       already has. The library window is not told, the Voice Manager reading its
       list as it opens. */
    if (result.savedTo && db.getSettings().audioToVoice === 'on') {
      try {
        db.addVoice({
          gameId,
          characterId: null,
          title: path.basename(result.savedTo, path.extname(result.savedTo)),
          filePath: copyVoiceFile(result.savedTo),
          sourcePath: result.savedTo
        })
      } catch {
        // Filing it is a convenience; the recording itself is already saved.
      }
    }
    broadcastCaptureState()
    return result
  })

  // Driven a frame at a time by the panel's collapse, so the window gives the
  // desktop back exactly as fast as the strip slides off it.
  ipcMain.on(IpcChannels.OverlaySetWidth, (_event, width: number) => {
    setOverlayWidth(width)
  })

  // A double-click of the panel's Move Button turns it around; the renderer has
  // flipped its own layout and asks the window to match.
  ipcMain.on(IpcChannels.OverlayFlipSide, () => {
    flipOverlaySide()
  })

  // The Move Button is dragged by the renderer rather than the OS (see the
  // OverlayApi note): the grab is registered on press, and the window follows
  // the pointer's screen position as it moves.
  ipcMain.on(IpcChannels.OverlayDragStart, (_event, mouseX: number, mouseY: number) => {
    overlayDragStart(mouseX, mouseY)
  })
  ipcMain.on(IpcChannels.OverlayDragMove, (_event, mouseX: number, mouseY: number) => {
    overlayDragMove(mouseX, mouseY)
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
