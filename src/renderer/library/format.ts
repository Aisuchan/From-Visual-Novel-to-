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

export function splitPlaytime(totalSeconds: number): { hours: number; minutes: number } {
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60)
  }
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

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatClock(date: Date): { dateLabel: string; timeLabel: string } {
  const dateLabel = `${date.getFullYear()} ${date.getMonth() + 1}/${date.getDate()} (${
    WEEKDAY_LABELS[date.getDay()]
  }.)`
  const pad = (n: number): string => String(n).padStart(2, '0')
  const timeLabel = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return { dateLabel, timeLabel }
}

/** Penpot footer shows "08/01 (Sat.)" and "11:23:58". */
export function formatFooterClock(date: Date): { dateLabel: string; timeLabel: string } {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    dateLabel: `${pad(date.getMonth() + 1)}/${pad(date.getDate())} (${
      WEEKDAY_LABELS[date.getDay()]
    }.)`,
    timeLabel: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
