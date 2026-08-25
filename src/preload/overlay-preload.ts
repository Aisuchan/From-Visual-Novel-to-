import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-types'
import type { OverlayApi, OverlayTickPayload } from '../shared/ipc-types'

const overlayApi: OverlayApi = {
  onTick: (cb: (payload: OverlayTickPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: OverlayTickPayload): void =>
      cb(payload)
    ipcRenderer.on(IpcChannels.OverlayTick, listener)
    return () => ipcRenderer.removeListener(IpcChannels.OverlayTick, listener)
  },
  takeScreenshot: () => ipcRenderer.invoke(IpcChannels.SessionScreenshot),
  togglePause: () => ipcRenderer.invoke(IpcChannels.SessionTogglePause),
  closeOverlay: () => ipcRenderer.send(IpcChannels.OverlayClose)
}

contextBridge.exposeInMainWorld('overlay', overlayApi)
