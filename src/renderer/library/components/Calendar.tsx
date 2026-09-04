import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatPlaytime, toDateKey } from '../format'
import OptionMenu from './OptionMenu'
import PlanPanel, { PLAN_PANEL_HEIGHT, PLAN_PANEL_WIDTH } from './PlanPanel'
import type { NewPlanInput, Plan } from '../../../shared/db-types'
import './Calendar.css'

/** Penpot writes the month out in full at the top of the board and names the
    month either side of it on the Bottom bar. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** Penpot: the seven weekday plates, the two ends of the week in their own
    ink and the five between them in #f5f8fa. */
const WEEKDAYS = [
  { label: 'Sun.', tone: 'sun' },
  { label: 'Mon.', tone: '' },
  { label: 'Tue.', tone: '' },
  { label: 'Wed.', tone: '' },
  { label: 'Thu.', tone: '' },
  { label: 'Fri.', tone: '' },
  { label: 'Sat.', tone: 'sat' }
]

/** Penpot draws six rows of seven, which is as many as any month needs. */
const CELLS = 42

/** Penpot: the board's own width, which the menus' placement is measured off —
    the same conversion the Setting board makes against its own 1585. */
const BOARD_WIDTH = 1585
/* Penpot: Menu — the design's own 201x295 board, which is what the year and
   the month drop out of. **201 is also exactly as wide as the month may be
   allowed to get**: the list is flush with the left of the run *and its mark*,
   and its right edge must not run past the run's own right edge, which is held
   at the board's 1505. The narrowest month is May, 162.8 wide in Girassol 100,
   so its button begins at 1505 − 162.8 − 39 (the mark and its gap) = 1303.2
   and the room left is 201.8. */
const HEAD_MENU_WIDTH = 201
/* The largest the rows go in that width. A menu keeps Penpot's 34 of rule and
   air on the left and 30 on the right, so the label column is 137; the longest
   month, September, is 120.6 wide at the design's own 28, and 137/120.6 takes
   that to 31 (133.5 wide) where 32 would overrun. */
const HEAD_MENU_FONT_SIZE = 31
/** The twelve months stand whole — a year is a fixed thing and a list of it
    that scrolls hides part of what is being chosen from. */
const MONTH_MENU_ROWS = 12
/** The years run to more than a hundred, so that list scrolls, six rows at a
    time — what every other menu in the app shows. */
const YEAR_MENU_ROWS = 6
/** The years offered, oldest first: what is older than the year on show is
    above it in the list and what is later is below, and the list opens brought
    to the year it stands on. */
const FIRST_YEAR = 1980
const LAST_YEAR = 2100

/** Penpot: Plan1/2/3 — three chips is as many as the 64px slot holds, and
    whatever is past that is counted on the Top strip's "+n" pill instead. */
const PLAN_ROWS = 3

interface Props {
  /** "See Playtime on Graph" — the PlayTime Graph board stands in this same
      slot, so it is a screen of its own rather than a face of this one: the
      shell is what swaps it in, which is what puts it in the history the
      mouse's side buttons walk and gives the switch its fade. */
  onOpenGraph: () => void
}

export default function Calendar({ onOpenGraph }: Props): React.JSX.Element {
  const today = new Date()
  /** Which month the grid is showing. The board opens on the one the clock
      that put it up is in. */
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth()
  }))
  /* Penpot draws Plans and PlayTime as two faces of the same slot in a day,
     and the Bottom bar's "Show Playtime" is what turns one into the other. */
  const [showPlaytime, setShowPlaytime] = useState(false)
  const [playtime, setPlaytime] = useState<Map<string, number>>(new Map())
  /* Every plan the 42 cells carry, read in one call and read again after a
     write — the way the game list is. Grouped by day for the cells and for the
     Plan panel, both of which want one day's own. */
  const [plans, setPlans] = useState<Plan[]>([])
  /* Penpot draws a ▼ beside the year and the month, hidden until the run is
     hovered: either drops a list out of its own run. Only one is ever up, so
     the board keeps one menu and one anchor — whichever run opened it, which
     is what tells `OptionMenu` to leave that button alone when it dismisses on
     a click. */
  const [menu, setMenu] = useState<{ kind: 'year' | 'month'; top: number; left: number } | null>(
    null
  )
  /* The day the Plan panel is open on, and where it sits in the board's own
     design pixels. Not in the design, which draws the panel and not where it
     is put: it is placed against the cell it belongs to. */
  const [planFor, setPlanFor] = useState<{ key: string; top: number; left: number } | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const cellRef = useRef<HTMLButtonElement | null>(null)
  /** The day a step has asked for that the grid was not showing: the month is
      changed for it and the panel placed once that grid is on screen. */
  const [pendingPlan, setPendingPlan] = useState<string | null>(null)

  /* The grid runs from the Sunday on or before the 1st, so it carries the tail
     of the month before and the head of the one after. */
  const start = new Date(cursor.year, cursor.month, 1)
  start.setDate(1 - start.getDay())
  const cells = Array.from(
    { length: CELLS },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
  )
  const firstKey = toDateKey(cells[0])
  const lastKey = toDateKey(cells[CELLS - 1])

  /* Read for the whole 42 cells rather than the month, since the days either
     side of it carry their play time too. Only asked for while the PlayTime
     face is the one on. */
  useEffect(() => {
    if (!showPlaytime) return
    let live = true
    window.library.getPlaytimeByDay(firstKey, lastKey).then((rows) => {
      if (live) setPlaytime(new Map(rows.map((row) => [row.date, row.seconds])))
    })
    return () => {
      live = false
    }
  }, [showPlaytime, firstKey, lastKey])

  const refreshPlans = useCallback(async (): Promise<void> => {
    setPlans(await window.library.listPlans(firstKey, lastKey))
  }, [firstKey, lastKey])

  useEffect(() => {
    let live = true
    window.library.listPlans(firstKey, lastKey).then((rows) => {
      if (live) setPlans(rows)
    })
    return () => {
      live = false
    }
  }, [firstKey, lastKey])

  const plansByDay = new Map<string, Plan[]>()
  for (const plan of plans) {
    const day = plansByDay.get(plan.date)
    if (day) day.push(plan)
    else plansByDay.set(plan.date, [plan])
  }

  function step(months: number): void {
    // The panel belongs to a day of the month being left, so it goes with it.
    setPlanFor(null)
    setCursor((current) => {
      const at = new Date(current.year, current.month + months, 1)
      return { year: at.getFullYear(), month: at.getMonth() }
    })
  }

  /* The menu hangs off the board rather than off the run, so its top and left
     are measured against the board's own known width the moment it opens. The
     whole button is what it is flush with, **the ▼ included** — the mark
     belongs to the control that is being opened, so the list begins where the
     control does. For the year that is the run's own left, the mark sitting
     after it; for the month it is 39 to the left of the name, which is where
     the mark stands. */
  function toggleMenu(kind: 'year' | 'month', button: HTMLButtonElement): void {
    const board = boardRef.current
    if (!board) return
    if (menu?.kind === kind) {
      setMenu(null)
      return
    }
    const boardRect = board.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const scale = boardRect.width / BOARD_WIDTH
    anchorRef.current = button
    setMenu({
      kind,
      top: (rect.bottom - boardRect.top) / scale,
      left: (rect.left - boardRect.left) / scale
    })
  }

  /* The row for the year and the month it is *now* carries the app's accent as
     its plate — the blue the Add Game button is — so a list scrolled somewhere
     else still says where today is. It is today's own, not the one on show:
     which one is on show is what the run above the list already reads. */
  /* The panel stands against the cell's own right edge, **centred on it**: the
     cell is what the panel is about, so the row it is in reads as the middle
     of it wherever the board has the room. Two things the board has to answer
     for: a cell in the last columns has no room for 319px to its right, so the
     panel goes to its left instead — beside the cell either way, rather than
     over it; and the panel is 637 tall against a row's 114, so the centring is
     given up at the top and bottom of the board, where it is held inside
     instead. */
  function placeFor(key: string, cell: HTMLButtonElement): void {
    const board = boardRef.current
    if (!board) return
    const boardRect = board.getBoundingClientRect()
    const rect = cell.getBoundingClientRect()
    const scale = boardRect.width / BOARD_WIDTH
    const cellLeft = (rect.left - boardRect.left) / scale
    const cellRight = (rect.right - boardRect.left) / scale
    const boardHeight = boardRect.height / scale
    cellRef.current = cell
    setPlanFor({
      key,
      left: cellRight + PLAN_PANEL_WIDTH <= BOARD_WIDTH ? cellRight : cellLeft - PLAN_PANEL_WIDTH,
      top: Math.max(
        0,
        Math.min(
          (rect.top + rect.height / 2 - boardRect.top) / scale - PLAN_PANEL_HEIGHT / 2,
          boardHeight - PLAN_PANEL_HEIGHT
        )
      )
    })
  }

  function togglePlan(key: string, cell: HTMLButtonElement): void {
    if (planFor?.key === key) {
      setPlanFor(null)
      return
    }
    placeFor(key, cell)
  }

  /* The panel's own two arrows walk the days. The panel goes where that day's
     own cell would have put it, so a step reads as the panel following the day
     rather than the day changing under it. A day past either end of the 42
     cells is one the grid is not showing, so the month it belongs to comes up
     and the panel is placed once that grid is on screen — which is what
     `pendingPlan` is waiting for. */
  function stepPlan(offset: number): void {
    if (!planFor) return
    const at = new Date(`${planFor.key}T00:00:00`)
    at.setDate(at.getDate() + offset)
    const key = toDateKey(at)
    const cell = boardRef.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)
    if (cell) {
      placeFor(key, cell)
      return
    }
    setCursor({ year: at.getFullYear(), month: at.getMonth() })
    setPendingPlan(key)
  }

  /* Placed before the frame is painted, so the panel does not show at the old
     month's place first. Cleared either way: a day the new grid does not carry
     is nothing to keep waiting for. */
  useLayoutEffect(() => {
    if (!pendingPlan) return
    const cell = boardRef.current?.querySelector<HTMLButtonElement>(
      `[data-date="${pendingPlan}"]`
    )
    if (cell) placeFor(pendingPlan, cell)
    setPendingPlan(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlan])

  const yearOptions = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => {
    const year = FIRST_YEAR + i
    return {
      key: String(year),
      label: String(year),
      current: year === today.getFullYear()
    }
  })

  const monthOptions = MONTH_NAMES.map((name, index) => ({
    key: String(index),
    label: name,
    current: index === today.getMonth()
  }))

  const prevMonth = new Date(cursor.year, cursor.month - 1, 1)
  const nextMonth = new Date(cursor.year, cursor.month + 1, 1)
  const todayKey = toDateKey(today)

  return (
    <div className="calendar-board" ref={boardRef}>
      {/* Penpot: Top — the year at one end, the month at the other. Each is a
          button carrying the design's own hidden "▼ hover" mark, which comes up
          while the run is under the pointer or its list is out. The year's sits
          after the run and the month's before it, so the run itself never moves
          off the design's own place. */}
      <div className="calendar-top">
        <button
          className={`calendar-year${menu?.kind === 'year' ? ' is-open' : ''}`}
          onClick={(event) => toggleMenu('year', event.currentTarget)}
          title="年を選ぶ"
        >
          <span className="calendar-head-run">{cursor.year}</span>
          <span className="calendar-head-caret">▼</span>
        </button>
        <button
          className={`calendar-month${menu?.kind === 'month' ? ' is-open' : ''}`}
          onClick={(event) => toggleMenu('month', event.currentTarget)}
          title="月を選ぶ"
        >
          <span className="calendar-head-caret">▼</span>
          <span className="calendar-head-run">{MONTH_NAMES[cursor.month]}</span>
        </button>
      </div>

      {/* Penpot: Calender — the weekday plates over six rows of seven days */}
      <div className="calendar-grid">
        {WEEKDAYS.map((day) => (
          <div className={`calendar-weekday ${day.tone}`} key={day.label}>
            {day.label}
          </div>
        ))}

        {cells.map((date) => {
          const key = toDateKey(date)
          const outside = date.getMonth() !== cursor.month
          const dayPlans = plansByDay.get(key) ?? []
          const seconds = playtime.get(key)
          return (
            <button
              type="button"
              className={`calendar-day${outside ? ' outside' : ''}${
                key === todayKey ? ' today' : ''
              }${planFor?.key === key ? ' is-open' : ''}`}
              key={key}
              data-date={key}
              onClick={(event) => togglePlan(key, event.currentTarget)}
              title={`${date.getMonth() + 1}/${date.getDate()} の予定`}
            >
              {/* Penpot: Top — the day's number, and the count of whatever
                  plans there was no room to draw */}
              <div className="calendar-day-top">
                <span className="calendar-day-number">{date.getDate()}</span>
                {dayPlans.length > PLAN_ROWS && (
                  <span className="calendar-day-more">+{dayPlans.length - PLAN_ROWS}</span>
                )}
              </div>

              <div className="calendar-day-slot">
                {showPlaytime
                  ? seconds !== undefined && (
                      <span className="calendar-day-playtime">{formatPlaytime(seconds)}</span>
                    )
                  : dayPlans.slice(0, PLAN_ROWS).map((plan) => (
                      <div
                        className="calendar-plan"
                        key={plan.id}
                        style={{ background: plan.color }}
                      >
                        {plan.name}
                      </div>
                    ))}
              </div>
            </button>
          )
        })}
      </div>

      {/* Penpot: Bottom — a step to either month and the two Playtime buttons */}
      <div className="calendar-bottom">
        <button
          className="calendar-step prev"
          onClick={() => step(-1)}
          title={`${MONTH_NAMES[prevMonth.getMonth()]} ${prevMonth.getFullYear()}`}
        >
          <span className="calendar-step-arrow">◀</span>
          <span className="calendar-step-month">{MONTH_NAMES[prevMonth.getMonth()]}</span>
        </button>

        {/* Penpot draws Plans and PlayTime as two faces of a day and writes
            only the one word on this button. It is what turns one into the
            other, so it says which face the press would put up rather than
            which is on — the word is the whole of the switch, and the cells
            behind it already say where it stands. */}
        <button
          className="calendar-bottom-button show-playtime"
          onClick={() => setShowPlaytime((on) => !on)}
        >
          {showPlaytime ? 'Show Plans' : 'Show Playtime'}
        </button>

        <button
          className="calendar-bottom-button go-graph"
          onClick={() => {
            setPlanFor(null)
            onOpenGraph()
          }}
        >
          See Playtime on Graph
        </button>

        <button
          className="calendar-step next"
          onClick={() => step(1)}
          title={`${MONTH_NAMES[nextMonth.getMonth()]} ${nextMonth.getFullYear()}`}
        >
          <span className="calendar-step-month">{MONTH_NAMES[nextMonth.getMonth()]}</span>
          <span className="calendar-step-arrow">▶</span>
        </button>
      </div>

      {planFor && (
        <PlanPanel
          date={cells.find((cell) => toDateKey(cell) === planFor.key) ?? today}
          dateKey={planFor.key}
          plans={plansByDay.get(planFor.key) ?? []}
          top={planFor.top}
          left={planFor.left}
          onClose={() => setPlanFor(null)}
          onStepDay={stepPlan}
          onAdd={async (input: NewPlanInput) => {
            await window.library.addPlan(input)
            await refreshPlans()
          }}
          onDelete={async (planId: number) => {
            await window.library.deletePlan(planId)
            await refreshPlans()
          }}
          anchorRef={cellRef}
        />
      )}

      {menu && (
        <OptionMenu
          options={menu.kind === 'year' ? yearOptions : monthOptions}
          onPick={(key) => {
            // The panel belongs to a day of the month being left.
            setPlanFor(null)
            setCursor((current) =>
              menu.kind === 'year'
                ? { ...current, year: Number(key) }
                : { ...current, month: Number(key) }
            )
            setMenu(null)
          }}
          top={menu.top}
          left={menu.left}
          width={HEAD_MENU_WIDTH}
          fontSize={HEAD_MENU_FONT_SIZE}
          maxRows={menu.kind === 'year' ? YEAR_MENU_ROWS : MONTH_MENU_ROWS}
          onDismiss={() => setMenu(null)}
          anchorRef={anchorRef}
          /* The year list is long and runs oldest first, so it opens on the
             year it stands at rather than at 1980. The months are all on show
             and need no such bringing to. */
          scrollToKey={menu.kind === 'year' ? String(cursor.year) : undefined}
        />
      )}
    </div>
  )
}
