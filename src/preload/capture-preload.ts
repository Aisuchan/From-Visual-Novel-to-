import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-types'
import type {
  CaptureApi,
  CaptureChunkPayload,
  CaptureCommand,
  CaptureMuxConfigPayload,
  CaptureMuxSamplePayload
} from '../shared/ipc-types'

const captureApi: CaptureApi = {
  ready: () => ipcRenderer.send(IpcChannels.CaptureReady),
  onCommand: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, command: CaptureCommand): void =>
      cb(command)
    ipcRenderer.on(IpcChannels.CaptureCommand, listener)
    return () => ipcRenderer.removeListener(IpcChannels.CaptureCommand, listener)
  },
  sendChunk: (payload: CaptureChunkPayload) => ipcRenderer.send(IpcChannels.CaptureChunk, payload),
  sendMuxConfig: (payload: CaptureMuxConfigPayload) =>
    ipcRenderer.send(IpcChannels.CaptureMuxConfig, payload),
  sendMuxSample: (payload: CaptureMuxSamplePayload) =>
    ipcRenderer.send(IpcChannels.CaptureMuxSample, payload),
  sendResult: (payload) => ipcRenderer.send(IpcChannels.CaptureResult, payload)
}

contextBridge.exposeInMainWorld('capture', captureApi)
