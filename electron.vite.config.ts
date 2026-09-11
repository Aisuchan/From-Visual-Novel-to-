import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/main/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          library: resolve(__dirname, 'src/preload/library-preload.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay-preload.ts'),
          capture: resolve(__dirname, 'src/preload/capture-preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    /* The bundled fonts are watched by nobody: they are megabytes of static
       bytes that never hot-reload, and `fs.watch` on one is a lock Windows
       hands out to a single holder — a font still being written, or opened by
       the system's own viewer, threw EBUSY out of chokidar and took the whole
       dev server down with it. */
    server: {
      watch: {
        ignored: ['**/src/renderer/fonts/**']
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          library: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          capture: resolve(__dirname, 'src/renderer/capture.html')
        }
      }
    },
    plugins: [react()]
  }
})
