import type {
  AppSettings,
  AudioFormat,
  DayPlaytime,
  DayGamePlaytime,
  FooterStats,
  GameImage,
  GameReference,
  GameWithStats,
  Group,
  HomeLayout,
  Language,
  LaunchPrefs,
  NewGameInput,
  NewGroupInput,
  NewPlanInput,
  NewRouteInput,
  OverlayCorner,
  Plan,
  ProgressState,
  PlayAdjustment,
  Route,
  RoutePatch,
  ScreenDisplay,
  SoundEffect,
  Session,
  Tag,
  NewVoiceInput,
  Voice,
  VoiceCharacter,
  VoicePatch,
  LedgerEntry,
  NewLedgerEntryInput
} from './db-types'

export const IpcChannels = {
  GamesList: 'games:list',
  GamesAdd: 'games:add',
  GamesUpdate: 'games:update',
  GamesDelete: 'games:delete',
  GamesReorder: 'games:reorder',
  GamesPickExe: 'games:pick-exe',
  GamesPickImage: 'games:pick-image',
  GamesExtractExeIcon: 'games:extract-exe-icon',
  GamesSetPlayTime: 'games:set-play-time',
  GamesSetThumbnail: 'games:set-thumbnail',
  GamesPickHomeImage: 'games:pick-home-image',
  GamesClearHomeImage: 'games:clear-home-image',
  GamesSetProgress: 'games:set-progress',
  GamesSetReference: 'games:set-reference',
  GameImagesList: 'game-images:list',
  GameImagesRandom: 'game-images:random',
  GameImagesSetR18: 'game-images:set-r18',
  GameImagesAdd: 'game-images:add',
  GameImagesDelete: 'game-images:delete',
  GameImagesReorder: 'game-images:reorder',
  ReferencePage: 'reference:page',
  ReferenceImage: 'reference:image',
  RoutesList: 'routes:list',
  RoutesAdd: 'routes:add',
  RoutesUpdate: 'routes:update',
  RoutesDelete: 'routes:delete',
  RoutesSetActive: 'routes:set-active',
  GroupsList: 'groups:list',
  GroupsAdd: 'groups:add',
  GroupsUpdate: 'groups:update',
  GroupsDelete: 'groups:delete',
  VoicesList: 'voices:list',
  VoicesPickFile: 'voices:pick-file',
  VoicesAdd: 'voices:add',
  VoicesDelete: 'voices:delete',
  VoicesUpdate: 'voices:update',
  LedgerList: 'ledger:list',
  LedgerAdd: 'ledger:add',
  LedgerDelete: 'ledger:delete',
  VoiceCharactersList: 'voice-characters:list',
  VoiceCharactersAdd: 'voice-characters:add',
  VoiceCharactersRename: 'voice-characters:rename',
  VoiceCharactersDelete: 'voice-characters:delete',
  TagsList: 'tags:list',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  DisplaysList: 'displays:list',
  SoundEffectsList: 'sound-effects:list',
  BackupPickDirectory: 'backup:pick-directory',
  CsvExport: 'csv:export',
  ShellShowItem: 'shell:show-item',
  ShellOpenExternal: 'shell:open-external',
  SettingsReset: 'settings:reset',
  BackupPickFile: 'backup:pick-file',
  BackupCheck: 'backup:check',
  BackupRestore: 'backup:restore',
  LibraryErase: 'library:erase',
  GamesFooterStats: 'games:footer-stats',
  LaunchPrefsGet: 'launch-prefs:get',
  LaunchPrefsSet: 'launch-prefs:set',
  SessionsList: 'sessions:list',
  SessionsDelete: 'sessions:delete',
  PlayAdjustmentsList: 'play-adjustments:list',
  PlayAdjustmentsDelete: 'play-adjustments:delete',
  SessionsPlaytimeByDay: 'sessions:playtime-by-day',
  SessionsPlaytimeByDayAndGame: 'sessions:playtime-by-day-and-game',
  PlansList: 'plans:list',
  PlansAdd: 'plans:add',
  PlansUpdate: 'plans:update',
  PlansDelete: 'plans:delete',
  SessionStart: 'session:start',
  SessionEnded: 'session:ended',
  SessionFailed: 'session:failed',
  SessionScreenshot: 'session:screenshot',
  SessionToggleVideo: 'session:toggle-video',
  SessionToggleAudio: 'session:toggle-audio',
  SessionTogglePause: 'session:toggle-pause',
  OverlayTick: 'overlay:tick',
  OverlayCaptureState: 'overlay:capture-state',
  OverlaySetWidth: 'overlay:set-width',
  OverlayPlayRecordEffect: 'overlay:play-record-effect',
  /* The hidden capture window is a worker: the main process sends it commands
     and it answers on the other two channels. */
  CaptureReady: 'capture:ready',
  CaptureCommand: 'capture:command',
  CaptureChunk: 'capture:chunk',
  CaptureResult: 'capture:result',
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowClose: 'window:close',
  WindowMaximizedChanged: 'window:maximized-changed'
} as const

export interface StartSessionRequest {
  gameId: number
  runAsAdmin: boolean
  useRecorderPanel: boolean
  recordTime: boolean
}

export interface StartSessionResult {
  sessionId: number
  gameTitle: string
}

/* A launch that could not be made. The check that can be made before anything
   is started — is the file still there — is answered by the call itself, so
   this is the other half: a spawn that failed once the session was already
   under way, which is asynchronous and cannot be thrown back to the caller. */
/** Which of the two recordings a sound is being asked for. */
export type RecordingKind = 'video' | 'audio'

export interface SessionFailedPayload {
  message: string
}

export interface SessionEndedPayload {
  sessionId: number
  gameId: number
  durationSeconds: number
}

export interface OverlayTickPayload {
  sessionId: number
  elapsedSeconds: number
  paused: boolean
}

export interface ScreenshotResult {
  /** Where the app kept its own copy. */
  filePath: string
  /** Where the player chose to put it, or null if they closed the dialog. */
  savedTo: string | null
}

/**
 * The answer to a recording button. Stopping one offers the finished file to
 * the player to name and put somewhere, so the result carries where it went.
 */
export interface CaptureToggleResult {
  state: CaptureState
  savedTo: string | null
}

/** Which of the Recorder Panel's two recordings are running. */
export interface CaptureState {
  video: boolean
  audio: boolean
}

export type CaptureTrack = 'video' | 'audio'

/**
 * Capture runs in a hidden renderer because `getDisplayMedia` and
 * `MediaRecorder` are web APIs: the main process picks the window and owns the
 * files, the worker owns the streams.
 */
export type CaptureCommand =
  /* The audio format reaches the worker as part of the command: it is the
     worker that encodes, and the setting is read once per capture so a change
     takes on the next one without a restart. A screenshot is not here — it is
     taken in the main process, off `desktopCapturer`. */
  | { id: number; kind: 'start-video' }
  | { id: number; kind: 'stop-video' }
  | { id: number; kind: 'start-audio'; format: AudioFormat }
  | { id: number; kind: 'stop-audio' }

export interface CaptureResultPayload {
  id: number
  error?: string
}

export interface CaptureChunkPayload {
  track: CaptureTrack
  data: Uint8Array
}

export interface CaptureApi {
  ready(): void
  onCommand(cb: (command: CaptureCommand) => void): () => void
  sendChunk(payload: CaptureChunkPayload): void
  sendResult(payload: CaptureResultPayload): void
}

export interface LibraryApi {
  listGames(): Promise<GameWithStats[]>
  addGame(input: NewGameInput): Promise<GameWithStats>
  updateGame(gameId: number, input: NewGameInput): Promise<GameWithStats>
  deleteGame(gameId: number): Promise<void>
  reorderGames(orderedIds: number[]): Promise<void>
  pickExecutable(): Promise<string | null>
  pickImage(): Promise<string | null>
  /** Writes the executable's icon to a PNG in userData and returns its path. */
  extractExeIcon(exePath: string): Promise<string | null>
  /* Sets TOTAL PLAY by hand. With `asPlayed` the change is written as a
     session dated now — of negative length for a subtraction — so the footer,
     the Calender board and the graph count it too; otherwise it is an offset
     on the game that only its own total reads. */
  setTotalPlaySeconds(gameId: number, seconds: number, asPlayed?: boolean): Promise<void>
  /** Applies one of the game's registered images as its main thumbnail —
      or none, which is what the gallery's CANCEL puts back for a game that
      had none when the gallery was opened. */
  setThumbnail(gameId: number, filePath: string | null): Promise<GameWithStats>
  /**
   * What a Home cell's right-click menu asks for: a picture for that one face,
   * picked and copied in one call so the copy lands in the face's own folder
   * rather than in the Add Thumbnail gallery's. `null` back means the dialog
   * was closed and nothing changed; `clearHomeImage` hands the cell back to the
   * game's Main Image and takes the copy off disk.
   *
   * A picture set this way is that face's alone — nowhere else in the app reads
   * these two, which is what keeps it off the Game board and out of the
   * gallery.
   */
  pickHomeImage(gameId: number, face: HomeLayout): Promise<GameWithStats | null>
  clearHomeImage(gameId: number, face: HomeLayout): Promise<GameWithStats>
  /**
   * Sets what the Progress triangle reads. `state` null hands it back to the
   * play history; `score` is only kept for 'cleared', and null there means the
   * game was cleared without one.
   */
  setProgress(
    gameId: number,
    state: ProgressState | null,
    score: number | null
  ): Promise<GameWithStats>
  listGameImages(gameId: number): Promise<GameImage[]>
  /** One entry out of every gallery in the library — or out of the ones
      marked R18 alone — or null with none. */
  randomGameImage(r18Only?: boolean): Promise<{ gameId: number; imageId: number } | null>
  /** Marks a picture R18 or unmarks it; the game's list comes back. */
  setGameImageR18(gameId: number, imageId: number, r18: boolean): Promise<GameImage[]>
  /** Opens the picker, copies the chosen files in, and returns the new list. */
  addGameImages(gameId: number): Promise<GameImage[]>
  deleteGameImage(gameId: number, imageId: number): Promise<GameImage[]>
  /** The order the Add Thumbnail grid was dragged into: the game's whole list,
      in the order it is to be read back in. */
  reorderGameImages(gameId: number, orderedIds: number[]): Promise<GameImage[]>

  /** The Add Game dialog's Reference row — an ErogameScape statistics page or a
      VNDB visual-novel page. It comes back as HTML and is read in the renderer,
      which is where an HTML parser is; the main process does the fetching, which
      is where it can be paced and identified. */
  fetchReferencePage(url: string): Promise<string>
  /** Downloads the picture that page points at and returns the app's own copy
      of it, which is what the thumbnail slot is given. */
  fetchReferenceImage(src: string, referer: string): Promise<string>
  /** The four values the Game Info board draws, as its own gear left them. */
  setGameReference(gameId: number, input: GameReference): Promise<GameWithStats>
  /** Opens a page in whatever the system uses for one. Only http and https,
      which is checked in the main process: this is the one call in the app that
      hands a string to the desktop. */
  openExternal(url: string): Promise<void>

  /** Every call returns the game's whole list, the way the images API does. */
  listRoutes(gameId: number): Promise<Route[]>
  addRoute(input: NewRouteInput): Promise<Route[]>
  updateRoute(gameId: number, routeId: number, patch: RoutePatch): Promise<Route[]>
  deleteRoute(gameId: number, routeId: number): Promise<Route[]>
  /** `null` for the Active Route stepper's "記録しない": nothing is recorded. */
  setActiveRoute(gameId: number, routeId: number | null): Promise<Route[]>

  /** The whole group list, as the routes API does — the Menu's own source. */
  listGroups(): Promise<Group[]>
  addGroup(input: NewGroupInput): Promise<Group[]>
  /** Renames and recolours one; the games filed under it are renamed with it. */
  updateGroup(id: number, input: NewGroupInput): Promise<Group[]>
  /** Takes it off the list and off the games that carried its name. */
  deleteGroup(id: number): Promise<Group[]>

  /* The Voice board. A voice is a clip or a track filed under a game and a
     character; the characters are one flat list of their own, kept the way
     the groups are. */
  listVoices(): Promise<Voice[]>
  /** The Add Voice dialog's Ref: an audio or video file, or `null` for the
      dialog closed. Nothing is copied until the voice is written. */
  pickVoiceFile(): Promise<string | null>
  /** Copies the file under `userData` and writes the row. */
  addVoice(input: NewVoiceInput): Promise<Voice[]>
  /** Takes the row off, and the app's copy of the file with it. */
  deleteVoice(id: number): Promise<Voice[]>
  /** Rewrites the row; a `sourcePath` in the patch is a new file, copied in
      and the old copy removed. */
  updateVoice(id: number, patch: VoicePatch): Promise<Voice[]>
  listVoiceCharacters(): Promise<VoiceCharacter[]>
  addVoiceCharacter(name: string): Promise<VoiceCharacter[]>
  renameVoiceCharacter(id: number, name: string): Promise<VoiceCharacter[]>
  deleteVoiceCharacter(id: number): Promise<VoiceCharacter[]>

  /* The Ledger board: a game bought or sold, for a price, on a day. */
  listLedgerEntries(): Promise<LedgerEntry[]>
  addLedgerEntry(input: NewLedgerEntryInput): Promise<LedgerEntry[]>
  deleteLedgerEntry(id: number): Promise<LedgerEntry[]>

  /* The tag vocabulary, which is read-only from a renderer: what puts a name
     into it and takes it out again is a game being written (`setGameTags`).
     The side panel's chips only read it to match what has been typed. */
  listTags(): Promise<Tag[]>

  /* The Setting board's own rows. Both calls answer with the whole of the
     settings, the way the routes and images APIs answer with a whole list. */
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  /* The desktop's displays, which the Recorder Panel's own row lists a corner
     of each of. Read when the Setting board opens rather than held: a display
     can be plugged in or unplugged while the app is running. */
  listDisplays(): Promise<ScreenDisplay[]>
  /* The Recorder Panel's effect sounds, read off the folder they are served
     from, so a file dropped in is an option without a build. */
  listSoundEffects(): Promise<SoundEffect[]>
  /* Names the folder the launch backup is written to. Answers with the path
     chosen, or null if the dialog was closed — the row keeps what it had. */
  pickBackupDirectory(): Promise<string | null>
  /* Writes the CSV export to a dated file in the given directory, returning the
     full path it was saved to. */
  exportCsv(directory: string, content: string): Promise<string>
  /* Reads a backup back over the library and restarts. Asks first, in the
     main process, and answers false if that was declined or the file was not
     a database. */
  restoreBackup(filePath: string): Promise<boolean>
  /** Names the backup file to read back. Null if the dialog was closed. */
  pickBackupFile(): Promise<string | null>
  /** Puts every row back to what it opens as. `null` if it was not confirmed. */
  resetSettings(): Promise<AppSettings | null>
  /* Erases the library — every row and every file the app made, the backups
     excepted — and restarts on an empty one. Asks twice, in the main process,
     and answers false if either was declined or a session is running. */
  eraseLibrary(): Promise<boolean>
  /** Whether that path is a file this build would read back — it exists and
      begins the way a SQLite database does. The 読み込み button is dead until
      it answers true. */
  checkBackup(filePath: string): Promise<boolean>
  /** The game's sessions, newest first — the Play Log board's source. */
  listSessions(gameId: number): Promise<Session[]>
  /* Takes one session off the game. Every total in the app is a sum over that
     table, so the time it carried goes with it. */
  deleteSession(gameId: number, sessionId: number): Promise<void>
  /** The edits made to a game's TOTAL PLAY by hand, for the Play log. */
  listPlayAdjustments(gameId: number): Promise<PlayAdjustment[]>
  /** Takes one off, and takes what it moved back off the total and its route. */
  deletePlayAdjustment(gameId: number, adjustmentId: number): Promise<void>
  /** Shows a file where it lives, in the system's own file browser. */
  /** Opens the folder with `filePath` picked out, or `fallback`'s folder when
      that file is no longer there. */
  showItemInFolder(filePath: string, fallback?: string | null): Promise<void>
  /** Recorded play time per local day over an inclusive "YYYY-MM-DD" range —
      what the Calender board's cells carry while "Show Playtime" is on. */
  getPlaytimeByDay(fromDate: string, toDate: string): Promise<DayPlaytime[]>
  /** What each game was played for on each day of the same kind of range — the
      PlayTime Graph board's whole source. */
  getPlaytimeByDayAndGame(fromDate: string, toDate: string): Promise<DayGamePlaytime[]>
  /* The Calender board's plans. The grid reads its own 42 cells in one call
     and reads them again after a write, the way the game list does. */
  listPlans(fromDate: string, toDate: string): Promise<Plan[]>
  addPlan(input: NewPlanInput): Promise<Plan>
  /** What a plan opened out of the Plan Detail board writes back. */
  updatePlan(planId: number, input: NewPlanInput): Promise<Plan>
  deletePlan(planId: number): Promise<void>
  getFooterStats(): Promise<FooterStats>
  getLaunchPrefs(gameId: number): Promise<LaunchPrefs>
  setLaunchPrefs(prefs: LaunchPrefs): Promise<void>
  startSession(req: StartSessionRequest): Promise<StartSessionResult>
  onSessionEnded(cb: (payload: SessionEndedPayload) => void): () => void
  onSessionFailed(cb: (payload: SessionFailedPayload) => void): () => void
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  onMaximizedChanged(cb: (maximized: boolean) => void): () => void
}

export interface OverlayApi {
  /* The corner the panel was opened in, and whether the app's arrivals run.
     Both are the Setting board's, and both come in on the window's own
     command line rather than over IPC: they decide which way round the panel
     is drawn, so a round trip would paint a frame of the wrong one. Neither
     changes while the panel is up — the corner is its *initial* position. */
  corner: OverlayCorner
  animate: boolean
  /* The file each of the panel's three effect sounds is, or '' for none. The
     main process resolves the Setting board's stored number to a name, so the
     page has nothing to look up. */
  shotSound: string
  videoSound: string
  audioSound: string
  /* How large the panel is drawn — the Setting board's レコーダーパネルのサイズ
     row. The page keeps the design's own figures and scales itself as a whole,
     the way the library window does, and the width it reports back is in those
     same design pixels: the main process scales what it is given. */
  scale: number
  /** The 言語/language row, for the panel's own runs. */
  language: Language
  onTick(cb: (payload: OverlayTickPayload) => void): () => void
  onCaptureState(cb: (state: CaptureState) => void): () => void
  /* Fired as a recording's save dialog comes up, which is when its effect
     sound is played: the recorder has stopped and the file is closed by then,
     so the sound lands after the last byte rather than in it, and the player
     hears it as the dialog arrives rather than once they have answered it. */
  onPlayRecordEffect(cb: (kind: RecordingKind) => void): () => void
  takeScreenshot(): Promise<ScreenshotResult>
  /** Starts or stops recording the game window, in the Setting board's format. */
  toggleVideo(): Promise<CaptureToggleResult>
  /** Starts or stops recording the system's audio, likewise. */
  toggleAudio(): Promise<CaptureToggleResult>
  togglePause(): Promise<{ paused: boolean }>
  /**
   * Sets the panel window's width, holding the edge the panel is anchored to
   * — its right in a right-hand corner, its left in a left-hand one. Called
   * once per animation frame while the panel collapses, so the desktop behind
   * is uncovered as the strip slides rather than all at once at the end.
   */
  setWidth(width: number): void
}
