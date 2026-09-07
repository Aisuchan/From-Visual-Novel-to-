import { useLayoutEffect, useRef, useState } from 'react'
import { formatPlaytime } from '../format'
import './PlanPanel.css'

/** One game's share of a day, as the card's list draws it. */
export interface DayPlaytimeRow {
  key: string
  name: string
  seconds: number
  color: string
}

/** How far off the pointer the card stands, the way the Game Hover board does
    on the Home board. */
const POINTER_GAP = 16

interface Props {
  /** Penpot writes the date as "12/31". */
  date: Date
  /** What that day was played for, per game, largest first. */
  rows: DayPlaytimeRow[]
  /** Where the pointer is, in the board's own design pixels. */
  pointer: { x: number; y: number }
  boardWidth: number
  boardHeight: number
}

/**
 * What a day was played for, per game — the Plan panel's own frame with that
 * list in it and nothing else: no plans, no head mark, no ADD PLAN, no day
 * steps. It is not opened and closed the way the Plan panel is; it stands while
 * a cell is under the pointer and follows it, off its lower right, so the day
 * it is about is the day the pointer is on.
 *
 * It takes no pointer events: it is drawn over the very cells it reports on,
 * and a card that could be pointed at would take the hover from the cell it
 * belongs to and flicker.
 */
export default function DayTimeCard({
  date,
  rows,
  pointer,
  boardWidth,
  boardHeight
}: Props): React.JSX.Element {
  /* Where it stands. The card is as tall as its list makes it, so that is
     measured rather than assumed, and it is then put off the pointer's lower
     right and held on the board: past the right edge it goes to the pointer's
     left instead, and past the bottom it is held inside rather than turned
     over, which keeps it under the pointer either way — the same two rules the
     Home board's Game Hover follows. In a layout effect, so it is never painted
     at the place a taller card could not have. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // The card is laid out in design pixels under the shell's zoom, so the
    // measured rect is scaled back by the frame's own known width.
    const scale = rect.width / 319
    const width = rect.width / scale
    const height = rect.height / scale
    const left =
      pointer.x + POINTER_GAP + width <= boardWidth
        ? pointer.x + POINTER_GAP
        : Math.max(0, pointer.x - POINTER_GAP - width)
    const top = Math.max(0, Math.min(pointer.y + POINTER_GAP, boardHeight - height))
    setAt({ top, left })
  }, [pointer.x, pointer.y, boardWidth, boardHeight, rows])

  return (
    <div
      className="plan-panel is-playtime is-following"
      ref={rootRef}
      style={at ?? { top: pointer.y + POINTER_GAP, left: pointer.x + POINTER_GAP, opacity: 0 }}
      aria-hidden="true"
    >
      {/* The Plan panel's own head, with nothing on it to press. */}
      <div className="plan-panel-head">
        <span className="plan-panel-date">
          {date.getMonth() + 1}/{date.getDate()}
        </span>
      </div>

      <div className="plan-panel-rule" />

      <div className="plan-panel-times">
        {rows.length === 0 ? (
          <span className="plan-panel-empty">no playtime</span>
        ) : (
          rows.map((row) => (
            <div className="plan-panel-legend-row" key={row.key}>
              <span className="plan-panel-legend-dot" style={{ background: row.color }} />
              <span className="plan-panel-legend-name">{row.name}</span>
              <span className="plan-panel-legend-time">{formatPlaytime(row.seconds)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
