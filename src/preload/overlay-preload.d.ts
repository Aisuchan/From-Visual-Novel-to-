import type { OverlayApi } from '../shared/ipc-types'

declare global {
  interface Window {
    overlay: OverlayApi
  }
}
