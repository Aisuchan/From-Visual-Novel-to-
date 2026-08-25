import type { LibraryApi } from '../shared/ipc-types'

declare global {
  interface Window {
    library: LibraryApi
  }
}
