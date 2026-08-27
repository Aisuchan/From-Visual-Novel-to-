/**
 * Thumbnails and icons are stored outside the app bundle (the main process
 * copies them into `userData`), and the renderer cannot reach them over
 * `file://`: in dev the page is served from `http://localhost`, where Chromium
 * refuses to load local files at all, so every image silently came up blank.
 *
 * They are served over a custom scheme instead, handled in the main process
 * (`src/main/media-protocol.ts`), which works the same in dev and packaged.
 */
export const MEDIA_SCHEME = 'fvn-media'
export const MEDIA_HOST = 'local'

/**
 * `C:\dir\a b.png` → `fvn-media://local/C%3A/dir/a%20b.png`. Each segment is
 * percent-encoded (this app lives under a Japanese user directory, so paths
 * are routinely non-ASCII); the drive letter's colon survives as `%3A`.
 */
export function mediaUrl(filePath: string): string {
  const encoded = filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encoded}`
}
