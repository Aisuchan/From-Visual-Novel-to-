import type { FooterStats, GameImage, GameWithStats, LaunchPrefs, NewGameInput } from './db-types'

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
  GameImagesList: 'game-images:list',
  GameImagesAdd: 'game-images:add',
  GameImagesDelete: 'game-images:delete',
  GamesFooterStats: 'games:footer-stats',
  LaunchPrefsGet: 'launch-prefs:get',
  LaunchPrefsSet: 'launch-prefs:set',
  SessionStart: 'session:start',
  SessionEnded: 'session:ended',
  SessionScreenshot: 'session:screenshot',
  SessionTogglePause: 'session:toggle-pause',
  OverlayTick: 'overlay:tick',
  OverlayToggleShrink: 'overlay:toggle-shrink',
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
  filePath: string
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
  listGameImages(gameId: number): Promise<GameImage[]>
  /** Opens the picker, copies the chosen files in, and returns the new list. */
  addGameImages(gameId: number): Promise<GameImage[]>
  deleteGameImage(gameId: number, imageId: number): Promise<GameImage[]>
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
  takeScreenshot(): Promise<ScreenshotResult>
  togglePause(): Promise<{ paused: boolean }>
  /** Narrows the panel window to the buttons the shrunk design keeps. */
  setShrunk(shrunk: boolean): Promise<{ shrunk: boolean }>
}
