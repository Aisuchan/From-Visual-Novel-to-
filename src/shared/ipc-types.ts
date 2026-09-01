import type {
  FooterStats,
  GameImage,
  GameWithStats,
  Group,
  LaunchPrefs,
  NewGameInput,
  NewGroupInput,
  NewRouteInput,
  ProgressState,
  Route,
  RoutePatch,
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
  | { id: number; kind: 'screenshot' }
  | { id: number; kind: 'start-video' }
  | { id: number; kind: 'stop-video' }
  | { id: number; kind: 'start-audio' }
  | { id: number; kind: 'stop-audio' }

export interface CaptureResultPayload {
  id: number
  error?: string
  /** `screenshot` only: the PNG bytes, written out by the main process. */
  png?: Uint8Array
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
  /** Starts or stops recording the game window to a .webm. */
  toggleVideo(): Promise<CaptureToggleResult>
  /** Starts or stops recording the system's audio to a .webm. */
  toggleAudio(): Promise<CaptureToggleResult>
  togglePause(): Promise<{ paused: boolean }>
  /**
   * Sets the panel window's width, holding its right edge. Called once per
   * animation frame while the panel collapses, so the desktop behind is
   * uncovered as the strip slides rather than all at once at the end.
   */
  setWidth(width: number): void
}
