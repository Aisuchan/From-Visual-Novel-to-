/**
 * **Reading a reference page.** The fetching is the main process's
 * (`src/main/reference.ts`, where it can be paced and identified); what the
 * page *says* is read here, because this is where an HTML parser is.
 *
 * `DOMParser` runs no scripts and loads nothing — it builds a detached document
 * out of the text and stops — so the page's own markup never becomes part of
 * this one and never reaches the network.
 *
 * The shapes below are the page's own, and they are read defensively: every
 * field is optional, because a page that has changed should give up one field
 * rather than the whole read.
 */
import type { VndbReleaseLanguage } from '../../shared/db-types'

export type ReferenceSite = 'erogamescape' | 'vndb'

/* The same list the main process checks against (`SITES` there): the host, and
   the shape of the one path on it this can read. Written twice on purpose —
   the row has to say whether a URL will work without asking the site, and the
   main process must not take the renderer's word for what it may open. */
const SITES: { site: ReferenceSite; host: string; path: RegExp }[] = [
  { site: 'erogamescape', host: 'erogamescape.dyndns.org', path: /^\/~ap2\/ero\/toukei_kaiseki\// },
  { site: 'vndb', host: 'vndb.org', path: /^\/v\d+\/?$/ }
]

/**
 * The address this row will read and which reference it is a page of, or null
 * for anything else.
 *
 * **`http` is taken and answered over `https`.** A link copied out of an old
 * bookmark or a forum post is as often one as the other, and refusing it would
 * be the row saying nothing while the button sat dead; the request itself is
 * always the secure one, which is what the main process will accept.
 */
export function referenceUrl(raw: string): { url: string; site: ReferenceSite } | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const match = SITES.find(
    (one) => parsed.hostname === one.host && one.path.test(parsed.pathname)
  )
  if (!match) return null
  parsed.protocol = 'https:'
  return { url: parsed.href, site: match.site }
}

export interface ReferenceEntry {
  title: string | null
  brand: string | null
  /** `YYYY-MM-DD`, which is the shape `games.release_date` is sorted on. */
  releaseDate: string | null
  /** Which language's release that date is, where the page lists them a
      language at a time. Null off ErogameScape, which lists one date. */
  releaseLanguage?: VndbReleaseLanguage | null
  /** The picture's address as written on the page; not downloaded here. */
  imageSrc: string | null
  medianScore: number | null
  averageScore: number | null
}

/** The first number in a run of text. The figure is in the row's own `td` —
    `<tr id="median"><th>中央値</th><td>67</td></tr>` — and that is what is read;
    this is the fallback for a row written some other way, where the label is
    「中央値」 and carries no digits of its own to be mistaken for one. */
function firstNumber(text: string | null | undefined): number | null {
  const match = /-?\d+(?:\.\d+)?/.exec(text ?? '')
  if (!match) return null
  const value = Number(match[0])
  return Number.isFinite(value) ? value : null
}

/**
 * A release date as the page writes it — `2013年09月27日`, or `2013/09/27`, or
 * `2013-09-27` — brought to the one shape the column is sorted on. Anything
 * else is left alone rather than guessed at.
 */
function toDateKey(text: string | null | undefined): string | null {
  const match = /(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/.exec(text ?? '')
  if (!match) return null
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

const clean = (text: string | null | undefined): string | null => {
  const trimmed = (text ?? '').replace(/\s+/g, ' ').trim()
  return trimmed === '' ? null : trimmed
}

/**
 * What the page carries, out of the elements the site names:
 *
 * - `#soft-title` — the title in the `span` it opens with, and then two links:
 *   the brand and the release date. (Read off the page: the span is a direct
 *   child of that div, and the two links stand after it in brackets.)
 * - `#main_image` — the picture, an `img` two levels down.
 * - `#median` / `#average` — the two figures.
 *
 * Each is looked for on its own, so a page that has moved one of them still
 * gives up the rest.
 */
export function parseErogamescape(html: string): ReferenceEntry {
  const page = new DOMParser().parseFromString(html, 'text/html')

  const heading = page.querySelector('#soft-title')
  /* The design of that heading is a title in a span and the brand and the date
     as the two links after it. Taken in that order rather than by position, so
     a link added around them does not shift what is read. */
  const links = heading ? Array.from(heading.querySelectorAll('a')) : []

  /* The figure is the row's own cell rather than the row's whole text: the row
     carries its label as well (`<th>中央値</th><td>67</td>`), and a label is not
     something to read a number out of. The row itself is the fallback. */
  const figure = (id: string): number | null => {
    const row = page.querySelector(id)
    if (!row) return null
    return firstNumber(row.querySelector('td')?.textContent ?? row.textContent)
  }

  return {
    title: clean(heading?.querySelector(':scope > span')?.textContent),
    brand: clean(links[0]?.textContent),
    releaseDate: toDateKey(links[1]?.textContent),
    imageSrc: page.querySelector('#main_image img')?.getAttribute('src') ?? null,
    medianScore: figure('#median'),
    averageScore: figure('#average')
  }
}


/* ----------------------------------------------------------------- VNDB ---- */

/**
 * The middle vote, worked out of the graph rather than looked up — VNDB writes
 * an average and a distribution and no median at all.
 *
 * The distribution is a count per score, so the middle vote is found by walking
 * the counts rather than by sorting anything: with an even number of votes the
 * two middle ones are taken and averaged, which is what a median is.
 */
function medianOfVotes(counts: { score: number; count: number }[]): number | null {
  const total = counts.reduce((sum, one) => sum + one.count, 0)
  if (total === 0) return null
  const ascending = [...counts].sort((a, b) => a.score - b.score)

  /** The score of the nth vote, counting from one. */
  const nth = (index: number): number => {
    let seen = 0
    for (const one of ascending) {
      seen += one.count
      if (index <= seen) return one.score
    }
    return ascending[ascending.length - 1].score
  }

  return total % 2 === 1
    ? nth((total + 1) / 2)
    : (nth(total / 2) + nth(total / 2 + 1)) / 2
}

/**
 * What a VNDB visual-novel page carries.
 *
 * - the name and the cover from the page's own `og:` meta, which is what that
 *   site puts them in and is the one place neither is wrapped in markup;
 * - the developer from the row of the info table that says so;
 * - **the release date from the first English release marked complete** — the
 *   releases are grouped into a `details` per language and each row's type is an
 *   `abbr` in its third cell (`icon-rtcomplete`, `icon-rtpartial`,
 *   `icon-rttrial`). A row whose date is only a year or a month cannot be stored
 *   in a column that is sorted as `YYYY-MM-DD`, so the first *dated* complete
 *   release is what is taken;
 * - the average from the vote table's own footer, and the median from its bars.
 */
/** What the page calls each of the three languages the row offers. */
const VNDB_LANGUAGE_LABEL: Record<VndbReleaseLanguage, string> = {
  en: 'English',
  zh: 'Chinese',
  ja: 'Japanese'
}

/**
 * The first complete release date in the block a language's own name heads, or
 * null where the page has no such block.
 *
 * The label is matched by its head, "Chinese" standing for both the traditional
 * and the simplified list, which the site writes as two labels beginning with
 * that word. A release with no full `YYYY-MM-DD` — the site writes a year alone
 * where that is all that is known — is passed over rather than guessed at.
 */
function releaseIn(page: Document, label: string): string | null {
  for (const group of Array.from(page.querySelectorAll('article.vnreleases details'))) {
    const heading = group.querySelector('summary abbr')?.getAttribute('title') ?? ''
    if (heading !== label && !heading.startsWith(`${label} `)) continue
    for (const row of Array.from(group.querySelectorAll('table.releases tr'))) {
      if (!row.querySelector('.icon-rtcomplete')) continue
      const date = clean(row.querySelector('td.tc1')?.textContent)
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date
    }
  }
  return null
}

export function parseVndb(html: string, language: VndbReleaseLanguage): ReferenceEntry {
  const page = new DOMParser().parseFromString(html, 'text/html')
  const meta = (property: string): string | null =>
    page.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null

  /* The info table is rows of a label cell and a value cell; the label is what
     is looked for rather than the row's position, which nothing guarantees. */
  let brand: string | null = null
  for (const row of Array.from(page.querySelectorAll('tr'))) {
    const cells = row.querySelectorAll('td')
    if (cells.length >= 2 && clean(cells[0].textContent) === 'Developer') {
      brand = clean(cells[1].textContent)
      break
    }
  }

  /* **Which block is read is the Setting board's own row, and 日本語版 is what
     answers when it is not there.** A visual novel is released once per market
     and the page lists them a language at a time, so the date the library wants
     is a question about the player rather than about the page — but plenty of
     games are never translated, and a library where exactly those games carry
     no date is worse than one where the date is the original's. So the row says
     which block is *preferred* and the Japanese one is the fallback, and which
     of them actually answered is handed back with the date: it is written on
     the game and drawn beside the date on the Game Info board, so a date is
     never left standing for a release it is not. */
  const tried: VndbReleaseLanguage[] = language === 'ja' ? ['ja'] : [language, 'ja']
  let releaseDate: string | null = null
  let releaseLanguage: VndbReleaseLanguage | null = null
  for (const candidate of tried) {
    releaseDate = releaseIn(page, VNDB_LANGUAGE_LABEL[candidate])
    if (releaseDate) {
      releaseLanguage = candidate
      break
    }
  }

  const graph = page.querySelector('table.votegraph')
  /* The footer reads "2534 votes (rank 128)" and then "8.74 average (rank 16)",
     so the figure is the one the word follows rather than the first on the row. */
  const footer = graph?.querySelector('tfoot')?.textContent ?? ''
  const average = /(\d+(?:\.\d+)?)\s*average/.exec(footer)
  const counts = Array.from(graph?.querySelectorAll('tr') ?? [])
    .map((row) => ({
      score: Number(clean(row.querySelector('td.number')?.textContent)),
      count: Number(clean(row.querySelector('td.graph')?.textContent))
    }))
    // The head and foot rows carry neither cell, so they fall out here.
    .filter((one) => Number.isFinite(one.score) && Number.isFinite(one.count))

  return {
    title: clean(meta('og:title')),
    brand,
    releaseDate,
    releaseLanguage,
    imageSrc: meta('og:image'),
    medianScore: medianOfVotes(counts),
    averageScore: average ? Number(average[1]) : null
  }
}
