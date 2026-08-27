import { app, net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEDIA_HOST, MEDIA_SCHEME } from '../shared/media-url'

/**
 * Must run before the app is ready. `standard` gives the scheme a normal
 * host/path split (so `new URL()` parses it), `secure` keeps it out of the
 * mixed-content block list, and `stream` lets ranged reads through.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

function resolveMediaPath(requestUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return null
  }
  if (parsed.host !== MEDIA_HOST) return null

  const decoded = decodeURIComponent(parsed.pathname).replace(/^\//, '')
  if (!decoded) return null
  const filePath = path.normalize(decoded)

  // Everything served here is written by the app into userData (`images/`,
  // `icons/`), so anything pointing outside it is a bug or an escape attempt.
  const relative = path.relative(app.getPath('userData'), filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return filePath
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    const filePath = resolveMediaPath(request.url)
    if (!filePath) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
