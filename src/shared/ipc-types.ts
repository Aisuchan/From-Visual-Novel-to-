import type {
  AppSettings,
  AudioFormat,
  FooterStats,
  GameImage,
  GameWithStats,
  Group,
  HomeLayout,
  LaunchPrefs,
  NewGameInput,
  NewGroupInput,
  NewRouteInput,
  ProgressState,
  Route,
  RoutePatch,
  ScreenshotFormat,
  Session,
  Tag
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
  GameImagesList: 'game-images:list',
  GameImagesAdd: 'game-images:add',
  GameImagesDelete: 'game-images:delete',
  RoutesList: 'routes:list',
  RoutesAdd: 'routes:add',
  RoutesUpdate: 'routes:update',
  RoutesDelete: 'routes:delete',
  RoutesSetActive: 'routes:set-active',
  GroupsList: 'groups:list',
  GroupsAdd: 'groups:add',
  TagsList: 'tags:list',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  GamesFooterStats: 'games:footer-stats',
  LaunchPrefsGet: 'launch-prefs:get',
  LaunchPrefsSet: 'launch-prefs:set',
  SessionsList: 'sessions:list',
  SessionStart: 'session:start',
  SessionEnded: 'session:ended',
  SessionScreenshot: 'session:screenshot',
  SessionToggleVideo: 'session:toggle-video',
  SessionToggleAudio: 'session:toggle-audio',
  SessionTogglePause: 'session:toggle-pause',
  OverlayTick: 'overlay:tick',
  OverlayCaptureState: 'overlay:capture-state',
  OverlaySetWidth: 'overlay:set-width',
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
  /* The two formats the Setting board can change reach the worker as part of
     the command: it is the worker that encodes, and the setting is read once
     per capture so a change takes on the next one without a restart. */
  | { id: number; kind: 'screenshot'; format: ScreenshotFormat }
  | { id: number; kind: 'start-video' }
  | { id: number; kind: 'stop-video' }
  | { id: number; kind: 'start-audio'; format: AudioFormat }
  | { id: number; kind: 'stop-audio' }

export interface CaptureResultPayload {
  id: number
  error?: string
  /** `screenshot` only: the encoded image, written out by the main process. */
  image?: Uint8Array
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
  setTotalPlaySeconds(gameId: number, seconds: number): Promise<void>
  /** Applies one of the game's registered images as its main thumbnail. */
  setThumbnail(gameId: number, filePath: string): Promise<GameWithStats>
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
  /** Opens the picker, copies the chosen files in, and returns the new list. */
  addGameImages(gameId: number): Promise<GameImage[]>
  deleteGameImage(gameId: number, imageId: number): Promise<GameImage[]>

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

  /* The tag vocabulary, which is read-only from a renderer: what puts a name
     into it and takes it out again is a game being written (`setGameTags`).
     The side panel's chips only read it to match what has been typed. */
  listTags(): Promise<Tag[]>

  /* The Setting board's own rows. Both calls answer with the whole of the
     settings, the way the routes and images APIs answer with a whole list. */
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  /** The game's sessions, newest first — the Play Log board's source. */
  listSessions(gameId: number): Promise<Session[]>
  getFooterStats(): Promise<FooterStats>
  getLaunchPrefs(gameId: number): Promise<LaunchPrefs>
  setLaunchPrefs(prefs: LaunchPrefs): Promise<void>
  startSession(req: StartSessionRequest): Promise<StartSessionResult>
  onSessionEnded(cb: (payload: SessionEndedPayload) => void): () => void
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  onMaximizedChanged(cb: (maximized: boolean) => void): () => void
}

export interface OverlayApi {
  onTick(cb: (payload: OverlayTickPayload) => void): () => void
  onCaptureState(cb: (state: CaptureState) => void): () => void
  takeScreenshot(): Promise<ScreenshotResult>
  /** Starts or stops recording the game window, in the Setting board's format. */
  toggleVideo(): Promise<CaptureToggleResult>
  /** Starts or stops recording the system's audio, likewise. */
  toggleAudio(): Promise<CaptureToggleResult>
  togglePause(): Promise<{ paused: boolean }>
  /**
   * Sets the panel window's width, holding its right edge. Called once per
   * animation frame while the panel collapses, so the desktop behind is
   * uncovered as the strip slides rather than all at once at the end.
   */
  setWidth(width: number): void
}
