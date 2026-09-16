import { app } from 'electron'
import electronUpdater from 'electron-updater'

/* electron-updater ships CommonJS, so the named export comes off the default. */
const { autoUpdater } = electronUpdater

/**
 * **Silent background update against the GitHub Releases the app is published
 * to.** There is no UI: the feed and the release notes are read from the
 * `app-update.yml` electron-builder embeds from the `publish` block, a newer
 * version is downloaded on its own, and it is installed the next time the app
 * quits (`autoInstallOnAppQuit`). So a release published to GitHub reaches an
 * installed copy on its own — the first launch after the publish downloads it,
 * and the launch after that is already on it.
 *
 * It runs only in a packaged build: electron-updater has no `app-update.yml` to
 * read in dev and would throw, and there is nothing to update there anyway.
 * Every failure — offline, no release yet, a rate limit — arrives on the
 * `error` event rather than as a thrown rejection, and is swallowed: an update
 * that cannot be checked for is not a reason to disturb a session, and the next
 * launch checks again.
 */
export function checkForUpdates(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (error) => {
    console.error('Update check failed:', error)
  })

  void autoUpdater.checkForUpdates().catch((error) => {
    console.error('Update check failed:', error)
  })
}
