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

/**
 * What the Add Thumbnail gallery takes. The pictures are what it has always
 * held; the clips are new, and the list is exactly what this runtime can play
 * back — mp4/m4v and mov (both ISO-BMFF, which is what the Recorder Panel's
 * own recordings are), webm and ogv. Matroska and AVI are deliberately left
 * off: the dialog would take them and nothing would draw them.
 */
export const GALLERY_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
export const GALLERY_VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'ogv']
/** What the Add Voice dialog's Ref takes beside the clips above: the audio
    this runtime plays back. A voice is as often a clip as a track. */
export const VOICE_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus']

/**
 * Whether a gallery entry is a clip rather than a picture.
 *
 * It is read off the name rather than stored: the extension is what the dialog
 * filtered on and what the copy under `userData` keeps, so nothing else has to
 * be written down and every row made before clips existed answers correctly.
 */
export function isVideoPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return false
  return GALLERY_VIDEO_EXTENSIONS.includes(filePath.slice(dot + 1).toLowerCase())
}
