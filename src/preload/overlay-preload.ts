import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-types'
import type {
  CaptureState,
  OverlayApi,
  OverlayTickPayload,
  RecordingKind
} from '../shared/ipc-types'
import type { Language, OverlayCorner } from '../shared/db-types'

/* The two things about the panel that are settled before it is drawn: which
   corner it opens in, which is also which way round its controls run, and
   whether the fold is animated at all. They come in on this window's own
   command line (`additionalArguments` in windows.ts) rather than over IPC,
   because a round trip would paint a frame of the panel the wrong way round. */
function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const overlayApi: OverlayApi = {
  corner: argument('overlay-corner', 'bottom-right') as OverlayCorner,
  animate: argument('overlay-animate', 'on') === 'on',
  shotSound: argument('overlay-shot-se', ''),
  videoSound: argument('overlay-video-se', ''),
  audioSound: argument('overlay-audio-se', ''),
  scale: Number(argument('overlay-scale', '1')) || 1,
  language: argument('overlay-language', 'ja') as Language,
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
  onPlayRecordEffect: (cb: (kind: RecordingKind) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, kind: RecordingKind): void => cb(kind)
    ipcRenderer.on(IpcChannels.OverlayPlayRecordEffect, listener)
    return () => ipcRenderer.removeListener(IpcChannels.OverlayPlayRecordEffect, listener)
  },
  takeScreenshot: () => ipcRenderer.invoke(IpcChannels.SessionScreenshot),
  toggleVideo: () => ipcRenderer.invoke(IpcChannels.SessionToggleVideo),
  toggleAudio: () => ipcRenderer.invoke(IpcChannels.SessionToggleAudio),
  togglePause: () => ipcRenderer.invoke(IpcChannels.SessionTogglePause),
  setWidth: (width: number) => ipcRenderer.send(IpcChannels.OverlaySetWidth, width)
}

contextBridge.exposeInMainWorld('overlay', overlayApi)
