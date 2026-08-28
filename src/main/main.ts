import { app, BrowserWindow } from 'electron'
import { registerCaptureHandlers } from './capture'
import { initDb } from './db'
import { registerIpcHandlers } from './ipc'
import { registerMediaProtocol, registerMediaScheme } from './media-protocol'
import { createLibraryWindow } from './windows'

// Scheme privileges have to be declared before the app is ready.
registerMediaScheme()

app.whenReady().then(() => {
  initDb()
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
