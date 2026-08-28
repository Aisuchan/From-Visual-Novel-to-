import type { CaptureApi } from '../shared/ipc-types'

declare global {
  interface Window {
    capture: CaptureApi
  }
}
