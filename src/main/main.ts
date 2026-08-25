import { app, BrowserWindow } from 'electron'
import { initDb } from './db'
import { registerIpcHandlers } from './ipc'
import { createLibraryWindow } from './windows'

app.whenReady().then(() => {
  initDb()
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
