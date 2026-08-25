import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-types'
import type { LaunchPrefs, NewGameInput } from '../shared/db-types'
import type { LibraryApi, SessionEndedPayload, StartSessionRequest } from '../shared/ipc-types'

const libraryApi: LibraryApi = {
  listGames: () => ipcRenderer.invoke(IpcChannels.GamesList),
  addGame: (input: NewGameInput) => ipcRenderer.invoke(IpcChannels.GamesAdd, input),
  deleteGame: (gameId: number) => ipcRenderer.invoke(IpcChannels.GamesDelete, gameId),
  reorderGames: (orderedIds: number[]) => ipcRenderer.invoke(IpcChannels.GamesReorder, orderedIds),
  pickExecutable: () => ipcRenderer.invoke(IpcChannels.GamesPickExe),
  pickImage: () => ipcRenderer.invoke(IpcChannels.GamesPickImage),
  getFooterStats: () => ipcRenderer.invoke(IpcChannels.GamesFooterStats),
  getLaunchPrefs: (gameId: number) => ipcRenderer.invoke(IpcChannels.LaunchPrefsGet, gameId),
  setLaunchPrefs: (prefs: LaunchPrefs) => ipcRenderer.invoke(IpcChannels.LaunchPrefsSet, prefs),
  startSession: (req: StartSessionRequest) => ipcRenderer.invoke(IpcChannels.SessionStart, req),
  onSessionEnded: (cb: (payload: SessionEndedPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionEndedPayload): void =>
      cb(payload)
    ipcRenderer.on(IpcChannels.SessionEnded, listener)
    return () => ipcRenderer.removeListener(IpcChannels.SessionEnded, listener)
  }
}

contextBridge.exposeInMainWorld('library', libraryApi)
