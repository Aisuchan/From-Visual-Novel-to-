import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-types'
import type {
  GameReference,
  HomeLayout,
  LaunchPrefs,
  NewGameInput,
  NewGroupInput,
  NewPlanInput,
  NewRouteInput,
  ProgressState,
  RoutePatch
} from '../shared/db-types'
import type {
  LibraryApi,
  SessionEndedPayload,
  SessionFailedPayload,
  StartSessionRequest
} from '../shared/ipc-types'

const libraryApi: LibraryApi = {
  listGames: () => ipcRenderer.invoke(IpcChannels.GamesList),
  addGame: (input: NewGameInput) => ipcRenderer.invoke(IpcChannels.GamesAdd, input),
  updateGame: (gameId: number, input: NewGameInput) =>
    ipcRenderer.invoke(IpcChannels.GamesUpdate, gameId, input),
  deleteGame: (gameId: number) => ipcRenderer.invoke(IpcChannels.GamesDelete, gameId),
  reorderGames: (orderedIds: number[]) => ipcRenderer.invoke(IpcChannels.GamesReorder, orderedIds),
  pickExecutable: () => ipcRenderer.invoke(IpcChannels.GamesPickExe),
  pickImage: () => ipcRenderer.invoke(IpcChannels.GamesPickImage),
  extractExeIcon: (exePath: string) => ipcRenderer.invoke(IpcChannels.GamesExtractExeIcon, exePath),
  setTotalPlaySeconds: (gameId: number, seconds: number) =>
    ipcRenderer.invoke(IpcChannels.GamesSetPlayTime, gameId, seconds),
  setThumbnail: (gameId: number, filePath: string) =>
    ipcRenderer.invoke(IpcChannels.GamesSetThumbnail, gameId, filePath),
  pickHomeImage: (gameId: number, face: HomeLayout) =>
    ipcRenderer.invoke(IpcChannels.GamesPickHomeImage, gameId, face),
  clearHomeImage: (gameId: number, face: HomeLayout) =>
    ipcRenderer.invoke(IpcChannels.GamesClearHomeImage, gameId, face),
  setProgress: (gameId: number, state: ProgressState | null, score: number | null) =>
    ipcRenderer.invoke(IpcChannels.GamesSetProgress, gameId, state, score),
  listGameImages: (gameId: number) => ipcRenderer.invoke(IpcChannels.GameImagesList, gameId),
  addGameImages: (gameId: number) => ipcRenderer.invoke(IpcChannels.GameImagesAdd, gameId),
  deleteGameImage: (gameId: number, imageId: number) =>
    ipcRenderer.invoke(IpcChannels.GameImagesDelete, gameId, imageId),
  reorderGameImages: (gameId: number, orderedIds: number[]) =>
    ipcRenderer.invoke(IpcChannels.GameImagesReorder, gameId, orderedIds),
  fetchReferencePage: (url: string) =>
    ipcRenderer.invoke(IpcChannels.ReferencePage, url),
  fetchReferenceImage: (src: string, referer: string) =>
    ipcRenderer.invoke(IpcChannels.ReferenceImage, src, referer),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.ShellOpenExternal, url),
  setGameReference: (gameId: number, input: GameReference) =>
    ipcRenderer.invoke(IpcChannels.GamesSetReference, gameId, input),

  listRoutes: (gameId: number) => ipcRenderer.invoke(IpcChannels.RoutesList, gameId),
  addRoute: (input: NewRouteInput) => ipcRenderer.invoke(IpcChannels.RoutesAdd, input),
  updateRoute: (gameId: number, routeId: number, patch: RoutePatch) =>
    ipcRenderer.invoke(IpcChannels.RoutesUpdate, gameId, routeId, patch),
  deleteRoute: (gameId: number, routeId: number) =>
    ipcRenderer.invoke(IpcChannels.RoutesDelete, gameId, routeId),
  setActiveRoute: (gameId: number, routeId: number | null) =>
    ipcRenderer.invoke(IpcChannels.RoutesSetActive, gameId, routeId),
  listGroups: () => ipcRenderer.invoke(IpcChannels.GroupsList),
  addGroup: (input: NewGroupInput) => ipcRenderer.invoke(IpcChannels.GroupsAdd, input),
  listTags: () => ipcRenderer.invoke(IpcChannels.TagsList),
  getSettings: () => ipcRenderer.invoke(IpcChannels.SettingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IpcChannels.SettingsSet, patch),
  listDisplays: () => ipcRenderer.invoke(IpcChannels.DisplaysList),
  listSoundEffects: () => ipcRenderer.invoke(IpcChannels.SoundEffectsList),
  pickBackupDirectory: () => ipcRenderer.invoke(IpcChannels.BackupPickDirectory),
  restoreBackup: (filePath: string) => ipcRenderer.invoke(IpcChannels.BackupRestore, filePath),
  pickBackupFile: () => ipcRenderer.invoke(IpcChannels.BackupPickFile),
  checkBackup: (filePath: string) => ipcRenderer.invoke(IpcChannels.BackupCheck, filePath),
  listSessions: (gameId: number) => ipcRenderer.invoke(IpcChannels.SessionsList, gameId),
  deleteSession: (gameId: number, sessionId: number) =>
    ipcRenderer.invoke(IpcChannels.SessionsDelete, gameId, sessionId),
  showItemInFolder: (filePath: string, fallback?: string | null) =>
    ipcRenderer.invoke(IpcChannels.ShellShowItem, filePath, fallback ?? null),
  getPlaytimeByDay: (fromDate: string, toDate: string) =>
    ipcRenderer.invoke(IpcChannels.SessionsPlaytimeByDay, fromDate, toDate),
  getPlaytimeByDayAndGame: (fromDate: string, toDate: string) =>
    ipcRenderer.invoke(IpcChannels.SessionsPlaytimeByDayAndGame, fromDate, toDate),
  listPlans: (fromDate: string, toDate: string) =>
    ipcRenderer.invoke(IpcChannels.PlansList, fromDate, toDate),
  addPlan: (input: NewPlanInput) => ipcRenderer.invoke(IpcChannels.PlansAdd, input),
  updatePlan: (planId: number, input: NewPlanInput) =>
    ipcRenderer.invoke(IpcChannels.PlansUpdate, planId, input),
  deletePlan: (planId: number) => ipcRenderer.invoke(IpcChannels.PlansDelete, planId),
  getFooterStats: () => ipcRenderer.invoke(IpcChannels.GamesFooterStats),
  getLaunchPrefs: (gameId: number) => ipcRenderer.invoke(IpcChannels.LaunchPrefsGet, gameId),
  setLaunchPrefs: (prefs: LaunchPrefs) => ipcRenderer.invoke(IpcChannels.LaunchPrefsSet, prefs),
  startSession: (req: StartSessionRequest) => ipcRenderer.invoke(IpcChannels.SessionStart, req),
  onSessionEnded: (cb: (payload: SessionEndedPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionEndedPayload): void =>
      cb(payload)
    ipcRenderer.on(IpcChannels.SessionEnded, listener)
    return () => ipcRenderer.removeListener(IpcChannels.SessionEnded, listener)
  },
  onSessionFailed: (cb: (payload: SessionFailedPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionFailedPayload): void =>
      cb(payload)
    ipcRenderer.on(IpcChannels.SessionFailed, listener)
    return () => ipcRenderer.removeListener(IpcChannels.SessionFailed, listener)
  },
  updateGroup: (id: number, input: NewGroupInput) =>
    ipcRenderer.invoke(IpcChannels.GroupsUpdate, id, input),
  deleteGroup: (id: number) => ipcRenderer.invoke(IpcChannels.GroupsDelete, id),
  resetSettings: () => ipcRenderer.invoke(IpcChannels.SettingsReset),
  minimizeWindow: () => ipcRenderer.send(IpcChannels.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.send(IpcChannels.WindowToggleMaximize),
  closeWindow: () => ipcRenderer.send(IpcChannels.WindowClose),
  onMaximizedChanged: (cb: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => cb(maximized)
    ipcRenderer.on(IpcChannels.WindowMaximizedChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.WindowMaximizedChanged, listener)
  }
}

contextBridge.exposeInMainWorld('library', libraryApi)
