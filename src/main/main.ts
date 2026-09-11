import { app, BrowserWindow } from 'electron'
import { pruneCaptureScratch, registerCaptureHandlers } from './capture'
import { backupDatabase, getSettings, initDb, pruneUnusedIcons } from './db'
import { applyLaunchAtLogin, registerIpcHandlers } from './ipc'
import { registerMediaProtocol, registerMediaScheme } from './media-protocol'
import { setLanguage, t } from '../shared/i18n'
import type { GpuMode } from '../shared/db-types'
import { createLibraryWindow } from './windows'

// Scheme privileges have to be declared before the app is ready.
registerMediaScheme()

/* Opened before the app is ready rather than inside `whenReady`: it only
   touches the filesystem, and `app.getPath('userData')` is the same path
   either side of ready. */
initDb()

/**
 * **The 描画方式 row, applied before the app is ready** — which is the only
 * time these can be set, and the whole reason a change to that row does nothing
 * until the app is started again.
 *
 * Each rung hands one more stage of the drawing to the CPU. See `GPU_MODES` for
 * what the row is for: on some machines the surface Chromium presents through is
 * resampled by the driver and everything in the window comes out soft, with no
 * scaling of any kind in play. Turning the GPU off answers that and gives up
 * more than it needs to, so the narrower switches stand above it.
 */
function applyGpuMode(mode: GpuMode): void {
  if (mode === 'no-direct-composition') {
    app.commandLine.appendSwitch('disable-direct-composition')
  } else if (mode === 'no-gpu-compositing') {
    app.commandLine.appendSwitch('disable-gpu-compositing')
  } else if (mode === 'off') {
    app.disableHardwareAcceleration()
  }
}

applyGpuMode(getSettings().gpuMode)

app.whenReady().then(() => {

  /* **The housekeeping first, and the backup after it**, so what is copied is
     what the library actually has rather than what has been lying about in it.
     Neither of these touches anything the library points at, so a backup taken
     after them is still of the library as it was left.

     Both are here rather than on the Setting board: they are not a choice, they
     are the app not leaving files in folders nothing points into. And both run
     before any window, where nothing can be recording and nothing can be
     choosing an icon — so a file still being written, or one just made and not
     yet saved to a row, is never caught by them. */
  pruneCaptureScratch(app.getPath('userData'))
  pruneUnusedIcons(app.getPath('userData'))

  /* The Setting board's 起動時にバックアップを作成 row, before any window is
     up: a backup is of the library as it was left, not as this run leaves it.
     Nothing is waited on — a copy that fails is a copy that fails, and the app
     is not the backup. */
  const settings = getSettings()
  /* The 言語/language row. Set before anything this process writes is written:
     its dialogs and the sentences it throws back to the renderer go through
     `t` too, and the panel is handed the answer on its command line. */
  setLanguage(settings.language)
  applyLaunchAtLogin(settings)

  if (settings.backupOnLaunch === 'on' && settings.backupDirectory) {
    void backupDatabase(settings.backupDirectory).catch((error) => {
      console.error(t('バックアップに失敗しました:'), error)
    })
  }

  registerMediaProtocol()
  registerCaptureHandlers()
  registerIpcHandlers()
  createLibraryWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLibraryWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
