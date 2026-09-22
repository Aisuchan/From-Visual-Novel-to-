import type { GraphPeriod } from '../../shared/db-types'

/* The twelve rows Penpot's "Setting Period" board
   (9b87421c-4b34-8035-8008-813a0596f964) draws, in its own order, and the
   range each of them means given today. Written once here because two things
   need them: the menu that draws the list and the board that reads the
   sessions the picked row covers. */

/** Midnight of the day an instant falls on, locally. */
export function localDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/** The Sunday on or before a day — the week the Calender board's grid draws. */
export function startOfWeek(at: Date): Date {
  const day = localDay(at)
  day.setDate(day.getDate() - day.getDay())
  return day
}

/** A whole run of calendar months, from `first` (which may be negative or past
    December — `Date` carries the year for us) for `count` of them. */
function months(year: number, first: number, count: number): { from: Date; to: Date } {
  return { from: new Date(year, first, 1), to: new Date(year, first + count, 0) }
}

function daysFrom(start: Date, offset: number): Date {
  const at = new Date(start)
  at.setDate(at.getDate() + offset)
  return at
}

export interface PeriodRow {
  key: GraphPeriod
  /** Penpot writes each of these in Girassol, which sets them as small caps. */
  label: string
  range: (today: Date) => { from: Date; to: Date }
}

export const PERIOD_ROWS: PeriodRow[] = [
  {
    key: 'today',
    label: 'Today',
    range: (today) => ({ from: localDay(today), to: localDay(today) })
  },
  {
    key: 'yesterday',
    label: 'Yesterday',
    range: (today) => ({ from: daysFrom(localDay(today), -1), to: daysFrom(localDay(today), -1) })
  },
  {
    key: 'this-week',
    label: 'This Week',
    range: (today) => ({ from: startOfWeek(today), to: daysFrom(startOfWeek(today), 6) })
  },
  {
    key: 'last-week',
    label: 'Last Week',
    range: (today) => ({
      from: daysFrom(startOfWeek(today), -7),
      to: daysFrom(startOfWeek(today), -1)
    })
  },
  {
    key: 'this-month',
    label: 'This Month',
    range: (today) => months(today.getFullYear(), today.getMonth(), 1)
  },
  {
    key: 'last-month',
    label: 'Last Month',
    range: (today) => months(today.getFullYear(), today.getMonth() - 1, 1)
  },
  {
    key: 'this-quarter',
    label: 'This Quarter',
    range: (today) => months(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 3)
  },
  {
    key: 'last-quarter',
    label: 'Last Quarter',
    range: (today) => months(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 - 3, 3)
  },
  {
    key: 'this-half',
    label: 'This Half Year',
    range: (today) => months(today.getFullYear(), Math.floor(today.getMonth() / 6) * 6, 6)
  },
  {
    key: 'last-half',
    label: 'Last Half Year',
    range: (today) => months(today.getFullYear(), Math.floor(today.getMonth() / 6) * 6 - 6, 6)
  },
  {
    key: 'this-year',
    label: 'This Year',
    range: (today) => months(today.getFullYear(), 0, 12)
  },
  {
    key: 'last-year',
    label: 'Last Year',
    range: (today) => months(today.getFullYear() - 1, 0, 12)
  },
  {
    /* The whole history. The span reaches far enough back to hold any session —
       nothing here predates a computer's own clock — and the graph clamps what
       it draws to the first day it actually finds data on. */
    key: 'all-time',
    label: 'All Time',
    range: (today) => ({ from: new Date(1990, 0, 1), to: localDay(today) })
  }
]

export function periodRow(key: GraphPeriod): PeriodRow {
  return PERIOD_ROWS.find((row) => row.key === key) ?? PERIOD_ROWS[0]
}
