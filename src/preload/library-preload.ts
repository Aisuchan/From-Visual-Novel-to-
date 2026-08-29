import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-types'
import type { LaunchPrefs, NewGameInput, ProgressState } from '../shared/db-types'
import type { LibraryApi, SessionEndedPayload, StartSessionRequest } from '../shared/ipc-types'

const libraryApi: LibraryApi = {
  listGames: () => ipcRenderer.invoke(IpcChannels.GamesList),
  addGame: (input: NewGameInput) => ipcRenderer.invoke(IpcChannels.GamesAdd, input),
  updateGame: (gameId: number, input: NewGameInput) =>
    ipcRenderer.invoke(IpcChannels.GamesUpdate, gameId, input),
  deleteGame: (gameId: number) => ipcRenderer.invoke(IpcChannels.GamesDelete, gameId),
  reorderGames: (orderedIds: number[]) => ipcRenderer.invoke(IpcChannels.GamesReorder, orderedIds),
  pickExecutable: () => ipcRenderer.invoke(IpcChannels.GamesPickExe),
  pickImage: () => ipcRenderer.invoke(IpcChannels.GamesPickImage),
  extractExeIcon: (exePath: string) =>
    ipcRenderer.invoke(IpcChannels.GamesExtractExeIcon, exePath),
  setTotalPlaySeconds: (gameId: number, seconds: number) =>
    ipcRenderer.invoke(IpcChannels.GamesSetPlayTime, gameId, seconds),
  setThumbnail: (gameId: number, filePath: string) =>
    ipcRenderer.invoke(IpcChannels.GamesSetThumbnail, gameId, filePath),
  setProgress: (gameId: number, state: ProgressState | null, score: number | null) =>
    ipcRenderer.invoke(IpcChannels.GamesSetProgress, gameId, state, score),
  listGameImages: (gameId: number) => ipcRenderer.invoke(IpcChannels.GameImagesList, gameId),
  addGameImages: (gameId: number) => ipcRenderer.invoke(IpcChannels.GameImagesAdd, gameId),
  deleteGameImage: (gameId: number, imageId: number) =>
    ipcRenderer.invoke(IpcChannels.GameImagesDelete, gameId, imageId),
  listSessions: (gameId: number) => ipcRenderer.invoke(IpcChannels.SessionsList, gameId),
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
