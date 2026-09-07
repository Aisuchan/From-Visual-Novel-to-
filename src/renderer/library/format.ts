import { getLanguage } from '../../shared/i18n'

export function formatHours(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  return `${hours}h`
}

/** Minute-resolution play time, e.g. "0h0m" … "999h59m" (minutes unpadded). */
export function formatPlaytime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h${minutes}m`
}

/** The same to the second, e.g. "0h0m0s" … "999h59m59s" — what the Game
    Hover's PLAYTIME row carries, where the design writes only the hours. */
export function formatPlaytimeSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${hours}h${minutes}m${seconds}s`
}

export function splitPlaytime(totalSeconds: number): { hours: number; minutes: number } {
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60)
  }
}

/** A local calendar day as "YYYY-MM-DD" — the key the Calender board's cells
    and the per-day play time it reads are matched on. `toISOString` would give
    the UTC day instead, which is the day before for any evening play. */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const MS_PER_DAY = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * "last played" collapses to a short label rather than a full date:
 * today / yesterday / mm/dd (within a year) / last year / n year ago.
 *
 * `lines` is the two-line form the narrow Penpot stat slot wants; `text` is
 * the same label on one line, for places with room for it.
 */
export function formatLastPlayed(iso: string | null): { lines: string[]; text: string } {
  const none = { lines: ['--'], text: '--' }
  if (!iso) return none

  const played = new Date(iso)
  if (Number.isNaN(played.getTime())) return none

  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(played)) / MS_PER_DAY)
  if (daysAgo <= 0) return { lines: ['today'], text: 'today' }
  if (daysAgo === 1) return { lines: ['yester', 'day'], text: 'yesterday' }

  const yearsAgo = Math.floor(daysAgo / 365)
  if (yearsAgo < 1) {
    const pad = (n: number): string => String(n).padStart(2, '0')
    const label = `${pad(played.getMonth() + 1)}/${pad(played.getDate())}`
    return { lines: [label], text: label }
  }
  if (yearsAgo === 1) return { lines: ['last', 'year'], text: 'last year' }
  return { lines: [`${yearsAgo} year`, 'ago'], text: `${yearsAgo} year ago` }
}

/* **A whole date is written the way the language writes one.** Japanese puts
   the year first and English the month, which is not something a dictionary can
   answer: the *order of the parts* changes, not the words. Only the Play log
   writes one — everywhere else a date is either the design's own stamp (the
   PlayTime Graph's, which stacks the parts) or a month and a day. */
export function formatFullDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  return getLanguage() === 'en' ? `${month}/${day}/${year}` : `${year}-${month}-${day}`
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatClock(date: Date): { dateLabel: string; timeLabel: string } {
  const dateLabel = `${date.getFullYear()} ${date.getMonth() + 1}/${date.getDate()} (${
    WEEKDAY_LABELS[date.getDay()]
  }.)`
  const pad = (n: number): string => String(n).padStart(2, '0')
  const timeLabel = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return { dateLabel, timeLabel }
}

/**
 * How much of the year has gone, 0 to 1. Measured against the year's own two
 * ends rather than against 365 days, so a leap year is 366 of them and the
 * figure still reaches exactly 1 at midnight on the 31st.
 *
 * Local midnights on both ends: a year turns where the player is.
 */
export function yearProgress(now: Date): number {
  const start = new Date(now.getFullYear(), 0, 1).getTime()
  const end = new Date(now.getFullYear() + 1, 0, 1).getTime()
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)))
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
