import { app, net } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { t } from '../shared/i18n'

/**
 * **The Reference row: one page, read once, gently.**
 *
 * This module is the whole of what talks to the site. It does the fetching and
 * nothing else — what the page *means* is read out of it in the renderer with
 * `DOMParser`, which is the one HTML parser this app already has and which runs
 * no scripts and loads no resources. So the network stays in the main process,
 * where it can be paced and identified, and the parsing stays where a
 * `querySelector` is a `querySelector`.
 *
 * **Everything here is about not being a nuisance.** A library manager reading
 * one page when a person presses a button is an ordinary visitor; the same code
 * without any of the below is a scraper. So:
 *
 * - **Only on a press.** Nothing is fetched while a URL is being typed, and
 *   nothing is fetched in the background. One press is at most two requests —
 *   the page, and the picture on it.
 * - **One at a time, and spaced.** Every request goes through one queue with
 *   `MIN_INTERVAL_MS` between them, so nothing this app does can burst.
 * - **Asked once.** A page already read is answered from memory for
 *   `CACHE_TTL_MS`; pressing the button again on the same URL costs the site
 *   nothing.
 * - **Never retried.** A failure is reported and stops there. Retrying is what
 *   turns one visitor's bad minute into a hundred requests.
 * - **Said who it is.** The User-Agent names this app and its version rather
 *   than pretending to be a browser, and the picture is asked for with the page
 *   it was found on as its referrer, which is what a browser sends.
 * - **Only the pages it can read.** A URL is checked against `SITES` before
 *   anything is opened — the host *and* the shape of the path — so this cannot
 *   be pointed at the rest of either site, or anywhere else. A page this cannot
 *   parse is a page there is no reason to ask for.
 */

/**
 * The two references, and the one page of each this reads. ErogameScape's
 * statistics pages are a directory; VNDB's visual-novel page is `/v` and a
 * number, and nothing else on that site is a game.
 */
const SITES = [
  { site: 'erogamescape' as const, host: 'erogamescape.dyndns.org', path: /^\/~ap2\/ero\/toukei_kaiseki\// },
  { site: 'vndb' as const, host: 'vndb.org', path: /^\/v\d+\/?$/ }
]

export type ReferenceSite = (typeof SITES)[number]['site']

/** The least time between two requests of any kind. */
const MIN_INTERVAL_MS = 3000
/** How long a page already read answers from memory. */
const CACHE_TTL_MS = 60 * 60 * 1000
const TIMEOUT_MS = 15000
/** A picture that is not a picture, or is absurd for a thumbnail, is not taken. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function userAgent(): string {
  return `from-visual-novel/${app.getVersion()} (personal visual-novel library manager)`
}

/** Which reference a URL is a page of, or null for anything else. */
export function siteOf(url: string): ReferenceSite | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  const match = SITES.find(
    (one) => parsed.hostname === one.host && one.path.test(parsed.pathname)
  )
  return match?.site ?? null
}

/* **One queue for every request this module makes.** Each waits for the one
   before it and then for whatever is left of `MIN_INTERVAL_MS` — so two presses
   in quick succession, or a page and the picture on it, are spaced rather than
   sent together. */
let queue: Promise<unknown> = Promise.resolve()
let lastAt = 0

function paced<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastAt)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      return await run()
    } finally {
      lastAt = Date.now()
    }
  })
  // The queue carries on whether or not this one worked.
  queue = next.catch(() => undefined)
  return next
}

/**
 * `net.fetch` goes through Chromium's own stack, so the system proxy and the
 * user's certificates are honoured the way every other request this app makes
 * is. The abort is what keeps a hung connection from holding the queue.
 *
 * **A referrer is asked for by name, never written as a header.** A request
 * made from the main process has no page behind it, so Chromium will not let it
 * carry a `Referer` the caller wrote itself: measured, the same request came
 * back `net::ERR_BLOCKED_BY_CLIENT` with the header and 200 without it, and 200
 * again with `referrer` given as what it is. The policy is Chromium's own
 * default, which sends the bare origin across sites — which is what a browser
 * would have sent for this picture anyway.
 */
async function request(
  url: string,
  headers: Record<string, string>,
  referrer?: string
): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    return await net.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': userAgent(), ...headers },
      ...(referrer ? { referrer, referrerPolicy: 'strict-origin-when-cross-origin' as const } : {}),
      signal: abort.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

const pages = new Map<string, { html: string; at: number }>()

/**
 * The page's HTML. What is done with it is the renderer's business.
 */
export async function fetchPage(url: string): Promise<string> {
  const trimmed = url.trim()
  if (!siteOf(trimmed)) {
    throw new Error(t('読み取れるページの URL ではありません'))
  }

  const kept = pages.get(trimmed)
  if (kept && Date.now() - kept.at < CACHE_TTL_MS) return kept.html

  const response = await paced(() =>
    request(trimmed, {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.8'
    })
  )
  if (!response.ok) {
    throw new Error(t('ページを読み込めませんでした ({0})', response.status))
  }
  const html = await response.text()
  pages.set(trimmed, { html, at: Date.now() })
  return html
}

/**
 * Downloads the picture the page points at and keeps a copy of it, which is
 * what the dialog's thumbnail slot is given.
 *
 * It goes where the Add Game dialog's own chosen thumbnail goes — `images/`
 * under `userData` — because that is what it is: the thumbnail this dialog will
 * register. `fvn-media:` serves nothing outside `userData`, so a picture left
 * where it was found could not be drawn at all.
 */
export async function fetchImage(src: string, referer: string): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(src, referer)
  } catch {
    throw new Error(t('画像の URL が読み取れませんでした'))
  }
  /* The picture on that page is not always on that host — it is usually a
     shop's own. Any https address is allowed, then; what is not is a `file:` or
     a `data:` dressed up as one. */
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(t('画像の URL が読み取れませんでした'))
  }

  const response = await paced(() =>
    request(
      parsed.href,
      { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8' },
      // The page the picture was found on, which is what a browser would send.
      referer
    )
  )
  if (!response.ok) throw new Error(t('画像を読み込めませんでした ({0})', response.status))

  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(t('画像ではありませんでした'))

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(t('画像を読み込めませんでした ({0})', bytes.length))
  }

  /* Named for what it is rather than for where it came from: the extension is
     read off the type the server gave, and the name is a UUID like every other
     copy this dialog makes. */
  const extension =
    type.includes('png') ? '.png'
    : type.includes('webp') ? '.webp'
    : type.includes('gif') ? '.gif'
    : '.jpg'
  const dir = path.join(app.getPath('userData'), 'images')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${randomUUID()}${extension}`)
  fs.writeFileSync(dest, bytes)
  return dest
}
