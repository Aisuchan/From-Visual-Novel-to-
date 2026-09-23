import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels } from '../shared/ipc-types'
import type {
  GameReference,
  HomeLayout,
  LaunchPrefs,
  NewGameInput,
  NewGroupInput,
  NewVoiceInput,
  VoicePatch,
  NewLedgerEntryInput,
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
  pickImage: (includeIco) => ipcRenderer.invoke(IpcChannels.GamesPickImage, includeIco),
  extractExeIcon: (exePath: string) => ipcRenderer.invoke(IpcChannels.GamesExtractExeIcon, exePath),
  setTotalPlaySeconds: (gameId: number, seconds: number, asPlayed?: boolean) =>
    ipcRenderer.invoke(IpcChannels.GamesSetPlayTime, gameId, seconds, asPlayed === true),
  setThumbnail: (gameId: number, filePath: string | null) =>
    ipcRenderer.invoke(IpcChannels.GamesSetThumbnail, gameId, filePath),
  pickHomeImage: (gameId: number, face: HomeLayout) =>
    ipcRenderer.invoke(IpcChannels.GamesPickHomeImage, gameId, face),
  clearHomeImage: (gameId: number, face: HomeLayout) =>
    ipcRenderer.invoke(IpcChannels.GamesClearHomeImage, gameId, face),
  setProgress: (gameId: number, state: ProgressState | null, score: number | null) =>
    ipcRenderer.invoke(IpcChannels.GamesSetProgress, gameId, state, score),
  listGameImages: (gameId: number) => ipcRenderer.invoke(IpcChannels.GameImagesList, gameId),
  randomGameImage: (r18Only?: boolean) =>
    ipcRenderer.invoke(IpcChannels.GameImagesRandom, r18Only === true),
  setGameImageR18: (gameId: number, imageId: number, r18: boolean) =>
    ipcRenderer.invoke(IpcChannels.GameImagesSetR18, gameId, imageId, r18),
  addGameImages: (gameId: number) => ipcRenderer.invoke(IpcChannels.GameImagesAdd, gameId),
  addGameImagesFromPaths: (gameId: number, paths: string[]) =>
    ipcRenderer.invoke(IpcChannels.GameImagesAddPaths, gameId, paths),
  /* A dropped File carries no usable path across contextIsolation; `webUtils`
     resolves it in the preload, which the renderer cannot reach itself. */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
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
  exportCsv: (directory: string, content: string) =>
    ipcRenderer.invoke(IpcChannels.CsvExport, directory, content),
  restoreBackup: (filePath: string) => ipcRenderer.invoke(IpcChannels.BackupRestore, filePath),
  pickBackupFile: () => ipcRenderer.invoke(IpcChannels.BackupPickFile),
  checkBackup: (filePath: string) => ipcRenderer.invoke(IpcChannels.BackupCheck, filePath),
  listSessions: (gameId: number) => ipcRenderer.invoke(IpcChannels.SessionsList, gameId),
  deleteSession: (gameId: number, sessionId: number) =>
    ipcRenderer.invoke(IpcChannels.SessionsDelete, gameId, sessionId),
  listPlayAdjustments: (gameId: number) =>
    ipcRenderer.invoke(IpcChannels.PlayAdjustmentsList, gameId),
  deletePlayAdjustment: (gameId: number, adjustmentId: number) =>
    ipcRenderer.invoke(IpcChannels.PlayAdjustmentsDelete, gameId, adjustmentId),
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
  listVoices: () => ipcRenderer.invoke(IpcChannels.VoicesList),
  pickVoiceFile: () => ipcRenderer.invoke(IpcChannels.VoicesPickFile),
  addVoice: (input: NewVoiceInput) => ipcRenderer.invoke(IpcChannels.VoicesAdd, input),
  deleteVoice: (id: number) => ipcRenderer.invoke(IpcChannels.VoicesDelete, id),
  updateVoice: (id: number, patch: VoicePatch) =>
    ipcRenderer.invoke(IpcChannels.VoicesUpdate, id, patch),
  listVoiceCharacters: () => ipcRenderer.invoke(IpcChannels.VoiceCharactersList),
  addVoiceCharacter: (name: string) => ipcRenderer.invoke(IpcChannels.VoiceCharactersAdd, name),
  renameVoiceCharacter: (id: number, name: string) =>
    ipcRenderer.invoke(IpcChannels.VoiceCharactersRename, id, name),
  deleteVoiceCharacter: (id: number) =>
    ipcRenderer.invoke(IpcChannels.VoiceCharactersDelete, id),
  listLedgerEntries: () => ipcRenderer.invoke(IpcChannels.LedgerList),
  addLedgerEntry: (input: NewLedgerEntryInput) =>
    ipcRenderer.invoke(IpcChannels.LedgerAdd, input),
  deleteLedgerEntry: (id: number) => ipcRenderer.invoke(IpcChannels.LedgerDelete, id),
  resetSettings: () => ipcRenderer.invoke(IpcChannels.SettingsReset),
  eraseLibrary: () => ipcRenderer.invoke(IpcChannels.LibraryErase),
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
