import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatPlaytime, toDateKey } from '../format'
import OptionMenu from './OptionMenu'
import PlanPanel, { PLAN_PANEL_HEIGHT, PLAN_PANEL_WIDTH, PLAN_STEP_SPACE } from './PlanPanel'
import DayTimeCard from './DayTimeCard'
import { colorForRank } from '../color'
import { displayName } from '../sort'
import type { GameWithStats, NewPlanInput, Plan } from '../../../shared/db-types'
import { motionMs } from '../motion'
import './Calendar.css'
import { t } from '../../../shared/i18n'

/** Penpot writes the month out in full at the top of the board and names the
    month either side of it on the Bottom bar. */
export const MONTH_NAMES = [
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
export const WEEKDAYS = [
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

/* Not in the design: the grid is read into rather than simply shown. Each cell
   takes the hover it would take under the pointer, one after the next from the
   top left in the days' own order — the board saying what it is a grid *of*
   before anything is asked of it. This is the wait between one cell and the
   next; the flash itself is `calendar-day-wave` in Calendar.css.

   **The flash lasts exactly as many of these steps as there are cells meant
   to be lit at once**, which is the whole of what holds the wave to that
   many: a cell goes out on the frame the tenth one after it comes up. */
const WAVE_STEP_MS = 30
const WAVE_CELLS_LIT = 10

interface Props {
  /** The library, which is what a day's own play time is broken down by while
      the PlayTime face is the one on. */
  games: GameWithStats[]
  /** Fired after a plan is written, so the shell can read today's own again. */
  onPlansChanged: () => void
  /** How long the board waits before the cells are read into — the pages that
      are turned off the column and the fade that follows them, which the shell
      holds this board back behind. A press on Show Playtime runs the same wave
      from nothing. */
  arriveDelay: number
  /** "See Playtime on Graph" — the PlayTime Graph board stands in this same
      slot, so it is a screen of its own rather than a face of this one: the
      shell is what swaps it in, which is what puts it in the history the
      mouse's side buttons walk and gives the switch its fade. */
  onOpenGraph: () => void
}

export default function Calendar({
  games,
  onPlansChanged,
  onOpenGraph,
  arriveDelay
}: Props): React.JSX.Element {
  const today = new Date()
  /** Which month the grid is showing. The board opens on the one the clock
      that put it up is in. */
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth()
  }))
  /* Penpot draws Plans and PlayTime as two faces of the same slot in a day,
     and the Bottom bar's "Show Playtime" is what turns one into the other. */
  /* The face the cells are settled on. It is not what a press on Show
     Playtime sets: the press starts a wave, and each cell takes the new face
     as that wave reaches it (`swapping` / `swapIndex` below), which is what
     this is finally set to once the last one has. */
  const [showPlaytime, setShowPlaytime] = useState(false)
  /* What the wave is carrying across the cells, and how many of them it has
     reached. Two things ride it: **a face** being switched to (`face`), which a
     cell takes as the wave arrives — until then it keeps the one it is on —
     and **a month** that has just come up (`face: null`), whose cells carry
     nothing at all until the wave reaches them. Null while the cells are
     settled. A press or a step is answered by the grid rather than by this
     state, so a second one while a wave is running is not taken — there is
     already one on its way across the cells. */
  const [carry, setCarry] = useState<{ face: boolean | null; delay: number } | null>(() => ({
    // The board's own arrival is a wave like any other, and it carries the
    // grid: the cells stand bare through the pages being turned off the column
    // and the fade behind them, and are filled in as the wave reaches them.
    face: null,
    delay: arriveDelay
  }))
  const [waveIndex, setWaveIndex] = useState(0)
  /* The wave over the cells: which run it is, and what it waits before the
     first cell. The run's number is what restarts it — a cell's animation is
     named for the run's parity, and changing an animation's name is what makes
     it run again without the grid being remounted (which would leave the open
     panel holding a cell that is no longer in the document). */
  const [wave, setWave] = useState(() => ({ run: 0, delay: arriveDelay }))
  const waveName = wave.run % 2 === 0 ? 'wave-a' : 'wave-b'
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
  /* Where the panel stands: the day it is on, the left the board worked out
     for it, and — for the vertical — the cell's own middle and the room there
     is, since the panel is not always the design's 637 tall and is the only
     one that knows which it is. */
  const [planFor, setPlanFor] = useState<{
    key: string
    middle: number
    left: number
    boardHeight: number
  } | null>(null)
  /* What each of the 42 days was played for, per game — what the card that
     follows the pointer reports. Read for the whole grid in one call rather
     than a day at a time: the card is answered by a pointer moving across the
     cells, and a read per cell is a round trip per cell. */
  const [dayGames, setDayGames] = useState<{ date: string; gameId: number; seconds: number }[]>([])
  /* The cell the pointer is on and where the pointer is, in the board's own
     design pixels — the card is placed off it and follows it. Only the PlayTime
     face has one: a day is then a question about play time, which is answered
     by pointing at it rather than by opening anything. */
  const [timeHover, setTimeHover] = useState<{ key: string; x: number; y: number } | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  /* The board's own height in design pixels. The rows stretch with the window,
     so it is measured rather than written down — the card that follows the
     pointer is held inside it. */
  const [boardSize, setBoardSize] = useState({ height: 988 })
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

  /* The card's own source, read for the 42 cells the grid draws and only while
     the PlayTime face is the one on. */
  useEffect(() => {
    if (!showPlaytime) {
      setDayGames([])
      setTimeHover(null)
      return
    }
    let live = true
    window.library.getPlaytimeByDayAndGame(firstKey, lastKey).then((rows) => {
      if (live) setDayGames(rows)
    })
    return () => {
      live = false
    }
  }, [firstKey, lastKey, showPlaytime])

  /* The switch walking the cells, on the same clock their flashes are on: a
     cell takes the new face as the wave reaches it, and the face is settled
     once the last one has. Only a switch runs this — the board's own arrival
     wave has no face to carry, and a loop per frame for it would be 42 renders
     of the grid for nothing. */
  useEffect(() => {
    if (!carry) return
    // The wave's own wait before its first cell, which the board's arrival has
    // and nothing else does. With the Setting board's アニメーション row off
    // there is no wave to wait for: the whole grid takes the face it is
    // carrying on the first frame.
    const step = motionMs(WAVE_STEP_MS)
    const begin = performance.now() + motionMs(carry.delay)
    let raf = 0
    const tick = (now: number): void => {
      const passed =
        step === 0
          ? CELLS
          : Math.max(0, Math.min(CELLS, Math.floor((now - begin) / step) + 1))
      // React drops a set that changes nothing, so this is a render per cell
      // rather than per frame.
      setWaveIndex(passed)
      if (passed < CELLS) {
        raf = requestAnimationFrame(tick)
        return
      }
      if (carry.face !== null) setShowPlaytime(carry.face)
      setCarry(null)
      setWaveIndex(0)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [carry])

  /* Sets the grid off being read again, carrying a face or — with null — a
     month that has just come up. The run's number is what restarts the cells'
     own flashes: a month step leaves the days either end of the grid on the
     same keys, so those cells are not remounted and would otherwise be the
     only ones the wave passed over without lighting (measured before the fix:
     stepping a month lit every row but the two the old grid shared). */
  function readIn(face: boolean | null): void {
    /* A new wave replaces whatever is crossing the cells rather than being
       turned away by it: the board's own arrival is a wave too, and a press or
       a step made while it is still running is a thing asked for and has to be
       answered. What the old wave was carrying is dropped with it — a face it
       had not finished laying down was never settled. */
    setCarry({ face, delay: 0 })
    setWaveIndex(0)
    setWave((current) => ({ run: current.run + 1, delay: 0 }))
  }

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

  /* Measured once the board is up and again whenever the window changes it. */
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const read = (): void => {
      const rect = board.getBoundingClientRect()
      setBoardSize({ height: rect.height / (rect.width / BOARD_WIDTH) })
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(board)
    return () => observer.disconnect()
  }, [])

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
    // A month is a new grid, and a new grid is read into the way the board's
    // own arrival is — its cells carrying nothing until the wave reaches them.
    readIn(null)
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
      boardHeight,
      /* The panel stands *on* the day it is about: its middle is the cell's
         middle. The day steps hang off either side, so what has to stay on the
         board is the panel and both of them, which is what the clamp leaves
         room for at each end. */
      left: Math.max(
        PLAN_STEP_SPACE,
        Math.min(
          (cellLeft + cellRight) / 2 - PLAN_PANEL_WIDTH / 2,
          BOARD_WIDTH - PLAN_PANEL_WIDTH - PLAN_STEP_SPACE
        )
      ),
      /* The cell's own middle, which the panel is centred on. The clamp that
         keeps it on the board is the panel's own: it is as tall as its face
         makes it — the PlayTime face is only as tall as its list — and a
         placement worked out here for the design's 637 would put a short panel
         well off the cell it belongs to. */
      middle: (rect.top + rect.height / 2 - boardRect.top) / scale
    })
  }

  function togglePlan(key: string, cell: HTMLButtonElement): void {
    /* A day is a question about play time while that face is on, and the card
       that answers it is already up under the pointer — there is nothing here
       to open. */
    if (showPlaytime) return
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
    // The panel has stepped over the end of the month, so this is a new grid
    // too, and it is read in like any other.
    readIn(null)
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

  /* The card's own rows for one day: its games largest first, each in the
     colour its rank gives it — the same rule the PlayTime Graph's ring, bars
     and list all read from. A game the library no longer has is left out. */
  function rowsForDay(key: string): {
    key: string
    name: string
    seconds: number
    color: string
  }[] {
    return dayGames
      .filter((row) => row.date === key)
      .map((row) => ({ ...row, game: games.find((one) => one.id === row.gameId) }))
      .filter((row) => row.game)
      .sort((a, b) => b.seconds - a.seconds)
      .map((row, index) => ({
        key: String(row.gameId),
        name: row.game ? displayName(row.game) : '',
        seconds: row.seconds,
        color: colorForRank(index)
      }))
  }

  /* Where the pointer is on the board, in its own design pixels — the same
     conversion every measured rect on this board goes through. */
  function boardPoint(event: React.MouseEvent): { x: number; y: number } | null {
    const board = boardRef.current
    if (!board) return null
    const rect = board.getBoundingClientRect()
    const scale = rect.width / BOARD_WIDTH
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale }
  }

  /* Which cell the pointer is over, and where it is. `mouseover` as well as
     `mousemove`: a pointer thrown across the grid can land on a cell without a
     single move being delivered over it, and nothing would come up at all. */
  function trackDay(event: React.MouseEvent): void {
    if (!showPlaytime) return
    const cell = (event.target as HTMLElement).closest('[data-date]')
    const key = cell instanceof HTMLElement ? cell.dataset.date : undefined
    if (!key) {
      setTimeHover(null)
      return
    }
    const at = boardPoint(event)
    if (at) setTimeHover({ key, x: at.x, y: at.y })
  }

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
          title={t('年を選ぶ')}
        >
          <span className="calendar-head-run">{cursor.year}</span>
          <span className="calendar-head-caret">▼</span>
        </button>
        <button
          className={`calendar-month${menu?.kind === 'month' ? ' is-open' : ''}`}
          onClick={(event) => toggleMenu('month', event.currentTarget)}
          title={t('月を選ぶ')}
        >
          <span className="calendar-head-caret">▼</span>
          <span className="calendar-head-run">{MONTH_NAMES[cursor.month]}</span>
        </button>
      </div>

      {/* Penpot: Calender — the weekday plates over six rows of seven days */}
      <div
        className="calendar-grid"
        onMouseMove={trackDay}
        onMouseOver={trackDay}
        onMouseLeave={() => setTimeHover(null)}
      >
        {WEEKDAYS.map((day) => (
          <div className={`calendar-weekday ${day.tone}`} key={day.label}>
            {day.label}
          </div>
        ))}

        {cells.map((date, index) => {
          const key = toDateKey(date)
          const outside = date.getMonth() !== cursor.month
          const dayPlans = plansByDay.get(key) ?? []
          const seconds = playtime.get(key)
          /* Where this cell stands in the wave, and so what it holds. A face
             being carried is taken as the wave arrives and the old one stands
             until then; a month being carried leaves the cell empty until then,
             its old contents belonging to a day that is no longer in it. */
          const reached = !carry || index < waveIndex
          const cellPlaytime = carry && carry.face !== null && !reached ? showPlaytime : (carry?.face ?? showPlaytime)
          const cellCarries = reached || carry?.face !== null
          /* Which of the two faces this cell is showing. Both are drawn at all
             times and the one that is not on is held at nothing, so a face
             *leaves* on the reverse of the movement it arrives on rather than
             simply being gone; unmounted, there was nothing left to animate
             and the switch was a fade in one direction only. */
          const showsPlans = cellCarries && !cellPlaytime
          const showsTime = cellCarries && cellPlaytime
          // The cell's own place in the wave: the days in their own order from
          // the top left, which is the order the grid is read in.
          const waveDelay = `${wave.delay + index * WAVE_STEP_MS}ms`
          return (
            <button
              type="button"
              className={`calendar-day ${waveName}${outside ? ' outside' : ''}${
                key === todayKey ? ' today' : ''
              }${planFor?.key === key ? ' is-open' : ''}`}
              key={key}
              data-date={key}
              /* The flash's length is stated here rather than in the sheet:
                 it is ten of the wave's own steps, and that is what holds
                 the wave to ten cells lit at a time. */
              style={{
                animationDelay: waveDelay,
                animationDuration: `${WAVE_STEP_MS * WAVE_CELLS_LIT}ms`
              }}
              onClick={(event) => togglePlan(key, event.currentTarget)}
              title={t('{0}/{1} の予定', date.getMonth() + 1, date.getDate())}
            >
              {/* Penpot: Top — the day's number, and the count of whatever
                  plans there was no room to draw */}
              <div className="calendar-day-top">
                <span className="calendar-day-number">{date.getDate()}</span>
                {/* The pill counts the plans there was no room to draw, so it
                    is part of what the cell *carries*: it waits for the wave
                    exactly as they do and it goes with them, being off the
                    cell wherever the face it holds is the play time. Standing
                    from the first frame, it was the one thing on a grid that
                    had not been read into yet; standing through the switch, it
                    was the one thing left of a face that had gone. The number
                    does not wait either way: it is what the grid is a grid of,
                    not something the wave is bringing. */}
                {dayPlans.length > PLAN_ROWS && (
                  <span className={`calendar-day-more${showsPlans ? '' : ' is-away'}`}>
                    +{dayPlans.length - PLAN_ROWS}
                  </span>
                )}
              </div>

              <div className="calendar-day-slot">
                {seconds !== undefined && (
                  <span className={`calendar-day-playtime${showsTime ? '' : ' is-away'}`}>
                    {formatPlaytime(seconds)}
                  </span>
                )}
                {dayPlans.length > 0 && (
                  <div className={`calendar-day-plans${showsPlans ? '' : ' is-away'}`}>
                    {dayPlans.slice(0, PLAN_ROWS).map((plan) => (
                      <div
                        className="calendar-plan"
                        key={plan.id}
                        style={{ background: plan.color }}
                      >
                        {plan.notify && <span className="plan-notify-dot" />}
                        {plan.name}
                      </div>
                    ))}
                  </div>
                )}
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
          onClick={async () => {
            /* The other face from the one on its way, rather than from the one
               settled: a second press while a switch is still crossing the
               cells is asking for it to be turned back. */
            const next = !(carry?.face ?? showPlaytime)
            /* The figures have to be in hand before the wave sets off: a cell
               takes its new face as the wave reaches it, and one that took it
               before the read landed would have nothing to put there. */
            if (next) {
              const rows = await window.library.getPlaytimeByDay(firstKey, lastKey)
              setPlaytime(new Map(rows.map((row) => [row.date, row.seconds])))
            }
            // The face is a new reading of the same grid, so it is read into
            // the way the board's own arrival is — from nothing this time.
            readIn(next)
          }}
        >
          {/* The word says what the next press would put up, and the press has
              been taken even though the cells are still turning over. */}
          {(carry?.face ?? showPlaytime) ? 'Show Plans' : 'Show Playtime'}
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

      {/* Not in the design: what the day under the pointer was played for. It
          follows the pointer rather than being opened on a cell — a day is a
          question about play time while that face is on, and pointing at one is
          the whole of asking it. */}
      {showPlaytime && timeHover && (
        <DayTimeCard
          date={new Date(`${timeHover.key}T00:00:00`)}
          rows={rowsForDay(timeHover.key)}
          pointer={{ x: timeHover.x, y: timeHover.y }}
          boardWidth={BOARD_WIDTH}
          boardHeight={boardSize.height}
        />
      )}

      {planFor && (
        <PlanPanel
          date={cells.find((cell) => toDateKey(cell) === planFor.key) ?? today}
          dateKey={planFor.key}
          plans={plansByDay.get(planFor.key) ?? []}
          middle={planFor.middle}
          boardHeight={planFor.boardHeight}
          left={planFor.left}
          onClose={() => setPlanFor(null)}
          onStepDay={stepPlan}
          /* While the PlayTime face is on, a day is a question about play time
             rather than about plans: the panel draws the day's own ring in the
             list's place. */
          onAdd={async (input: NewPlanInput) => {
            await window.library.addPlan(input)
            await refreshPlans()
            onPlansChanged()
          }}
          onUpdate={async (planId: number, input: NewPlanInput) => {
            await window.library.updatePlan(planId, input)
            await refreshPlans()
            onPlansChanged()
          }}
          onDelete={async (planId: number) => {
            await window.library.deletePlan(planId)
            await refreshPlans()
            onPlansChanged()
          }}
          boardWidth={BOARD_WIDTH}
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
            // The same new grid a month step makes, and read in the same way.
            readIn(null)
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
