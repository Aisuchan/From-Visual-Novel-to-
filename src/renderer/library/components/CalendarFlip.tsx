import { useEffect, useMemo, useRef } from 'react'
import { MONTH_NAMES, WEEKDAYS } from './Calendar'
import './CalendarFlip.css'

/** Six rows of seven, which is the Calender board's own grid — the page here is
    that grid with nothing on it but the numbers. */
const CELLS = 42

/** How many pages are turned before the board stands. */
const SHEETS = 2

/** How long a page takes to swing up and over, in milliseconds. Kept in step
    with `calendar-flip-turn`'s own duration in CalendarFlip.css. */
const FLIP_MS = 340

/** Between one page setting off and the next. Less than the turn itself on
    purpose: the second is lifted while the first is still going over, so the
    two read as one run of turns rather than as two separate ones. */
const STEP_MS = 150

/** How long the first page stands before it is lifted. The board has only just
    become a calendar page, and a page that is already going when it arrives is
    never read as one. */
const START_MS = 40

/** The whole run: how long the overlay stands for, and how long the board
    waits before it fades up behind it — the shell reads this for that. */
export const FLIP_TOTAL_MS = START_MS + (SHEETS - 1) * STEP_MS + FLIP_MS

interface Day {
  day: number
  /** Carried in from the month either side, which the board writes dim. */
  outside: boolean
}

interface Sheet {
  year: number
  month: number
  days: Day[]
}

/** The board's own grid for a month: the 42 cells from the Sunday on or before
    the 1st, which is what makes a page read as that month rather than as a
    sheet of ruled paper. */
function pageFor(year: number, month: number): Sheet {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const days = Array.from({ length: CELLS }, (_, index) => {
    const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    return { day: at.getDate(), outside: at.getMonth() !== month }
  })
  return { year, month, days }
}

interface Props {
  /** Fired once the last page is over, which is what takes the overlay away. */
  onDone: () => void
}

/**
 * Not in the design: the Calender board is turned to rather than simply shown.
 * The two months before the one the board opens on are drawn over the Main
 * Display as pages of a wall calendar and flicked away by their top-right
 * corners, one after the other. They come away onto the empty column and the
 * board fades up once they are gone, rather than being uncovered by them: it
 * has been mounted and reading its plans underneath the whole time, and the
 * pages are opaque, so nothing of that read is on screen until it is done
 * with.
 */
export default function CalendarFlip({ onDone }: Props): React.JSX.Element {
  /* The board opens on the month the clock is in, so the pages turned past are
     the ones before it, in order: the run arrives at the month the board is
     showing. */
  const pages = useMemo(() => {
    const today = new Date()
    return Array.from({ length: SHEETS }, (_, index) => {
      // index 0 is the top of the stack and the first to go, so it is the
      // furthest back: two months before the one underneath them both.
      const at = new Date(today.getFullYear(), today.getMonth() - (SHEETS - index), 1)
      return pageFor(at.getFullYear(), at.getMonth())
    })
  }, [])

  /* Through a ref: the shell hands this an inline callback, and depending on
     it would restart the timer — and so hold the overlay up — on every render
     the shell happens to make while the page is turning. */
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), FLIP_TOTAL_MS)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div className="calendar-flip" aria-hidden="true">
      {pages.map((page, index) => (
        <div
          key={`${page.year}-${page.month}`}
          className="calendar-flip-sheet"
          /* The earlier page is the one on top, since it is the one that goes
             first. The delay is set here rather than in the sheet's own rule so
             the shade can inherit it and fall exactly as that page lifts. */
          style={{ zIndex: SHEETS - index, animationDelay: `${START_MS + index * STEP_MS}ms` }}
        >
          <div className="calendar-flip-top">
            <span className="calendar-flip-year">{page.year}</span>
            <span className="calendar-flip-month">{MONTH_NAMES[page.month]}</span>
          </div>
          <div className="calendar-flip-grid">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday.label} className={`calendar-flip-weekday ${weekday.tone}`}>
                {weekday.label}
              </div>
            ))}
            {page.days.map((day, cell) => (
              <div key={cell} className={`calendar-flip-day ${day.outside ? 'outside' : ''}`}>
                {day.day}
              </div>
            ))}
          </div>
          <div className="calendar-flip-bottom" />
        </div>
      ))}
    </div>
  )
}
