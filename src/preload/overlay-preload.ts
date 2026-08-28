import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-types'
import type { CaptureState, OverlayApi, OverlayTickPayload } from '../shared/ipc-types'

const overlayApi: OverlayApi = {
  onTick: (cb: (payload: OverlayTickPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: OverlayTickPayload): void =>
      cb(payload)
    ipcRenderer.on(IpcChannels.OverlayTick, listener)
    return () => ipcRenderer.removeListener(IpcChannels.OverlayTick, listener)
  },
  onCaptureState: (cb: (state: CaptureState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CaptureState): void => cb(state)
    ipcRenderer.on(IpcChannels.OverlayCaptureState, listener)
    return () => ipcRenderer.removeListener(IpcChannels.OverlayCaptureState, listener)
  },
  takeScreenshot: () => ipcRenderer.invoke(IpcChannels.SessionScreenshot),
  toggleVideo: () => ipcRenderer.invoke(IpcChannels.SessionToggleVideo),
  toggleAudio: () => ipcRenderer.invoke(IpcChannels.SessionToggleAudio),
  togglePause: () => ipcRenderer.invoke(IpcChannels.SessionTogglePause),
  setWidth: (width: number) => ipcRenderer.send(IpcChannels.OverlaySetWidth, width)
}

contextBridge.exposeInMainWorld('overlay', overlayApi)
