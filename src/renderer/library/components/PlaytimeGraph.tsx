import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  DayGamePlaytime,
  GameWithStats,
  GraphPeriod,
  Group,
  Tag
} from '../../../shared/db-types'
import { colorForRank } from '../color'
import { filterGames, suggestsGroup } from '../filter'
import { toDateKey } from '../format'
import { periodRow, startOfWeek } from '../period'
import { displayName } from '../sort'
import OptionMenu from './OptionMenu'
import PeriodMenu from './PeriodMenu'
import PieChart from './PieChart'
import TagChip from './TagChip'
import { motionOff } from '../motion'
import './PlaytimeGraph.css'
import { t } from '../../../shared/i18n'

/** Penpot: PlayTime Graph — the board's own width, which the period menu's
    placement is measured off, the way the Setting board's is. */
const BOARD_WIDTH = 1585

/* The filter plate's two controls are the Home board's own, kept at that
   board's own widths: the Group pill and its ▼ come to Penpot's 331, and the
   tag chips have the rest of the 1117 the plate is. The list the ▼ drops is as
   wide as the pill it drops out of, which is what every menu in the app is —
   and it opens *upward*, the plate standing on the footer, which is
   `OptionMenu`'s own rule for a list that would run off the bottom. */
const GROUP_WIDTH = 331
const GROUP_MENU_ROWS = 8
/** The menu is set clear of the pill rather than flush under it, which is what
    the Home board's own two are. */
const MENU_GAP = 6
/** The row for no group at all, which is this plate's one-click release. */
const ALL_GROUPS_KEY = 'all-groups'

/** Penpot: Pie Chart — the design's own 750 circle, 118 down its column. */
const PIE_SIZE = 750
const PIE_TOP = 118

/** When the ring and the bars set off, measured from the board being mounted.
    The board slot's own fade — `.slow-fade` in App.css — runs 500, and this is
    half of it: the screen is half resolved and still coming up when what is on
    it starts to move, so the two overlap rather than queue. Waiting the whole
    fade out left a beat where the board simply stood there. */
const ARRIVAL_MS = 250

/** Penpot: Hover Pie Game — 375x136, the panel a wedge puts up. */
const HOVER_W = 375
const HOVER_H = 136

/* The name written in the middle of the ring. Penpot sets it at 48 in a box
   that cuts it off; there, with nothing else on the chart, it is set as large
   as it can be and still be read whole — at the cap on one line if it fits
   there, and otherwise on two lines at the largest size those hold, which is
   most of twice the size one line would have taken. */
const HOVER_NAME_WIDTH = 325
const HOVER_NAME_MAX = 44
const HOVER_NAME_MIN = 18
const HOVER_NAME_LINE = 1.15

/* How the list beside the ring arrives: a row waits by where it is in the
   list, so the whole of it comes up from the top down rather than at once. The
   wait is capped so a long library's last row is not still arriving after the
   first has settled, and it is measured from the same 250 the ring and the bars
   set off on. */
const LEGEND_STEP_MS = 35
const LEGEND_STEP_MAX_MS = 500

/** The room a row's own play time takes at the end of the box: the column the
    two figures are stacked in and the air before it. The bars share what is
    left of the track, so the longest one still ends inside the box and every
    figure is written in the clear. */
const HISTOGRAM_TIME_COLUMN = 52

/** The years the Calender board's own menu offers, which is as far as a date
    typed into a stamp may reach. */
const FIRST_YEAR = 1980
const LAST_YEAR = 2100

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** Days in an average month, which is what a month's average is divided by:
    365.25 / 12, so the three figures below are one rate read at three
    lengths rather than three different sums. */
const DAYS_IN_MONTH = 365.25 / 12

/* The three lengths the bottom-right plate reads the period at. `days` is what
   the day's own average is multiplied by; `least` is the longest a period can
   be and still leave the figure saying nothing — a period no longer than the
   unit puts the whole of itself into one of them, so what would be written is
   the total over again rather than an average, and 「--」 is written instead.
   A calendar month runs 28 to 31 days and every one of them is one month, so
   the longest of them is what the month's own figure is held against. */
const AVERAGE_UNITS = [
  { label: '1日', days: 1, least: 1 },
  { label: '1週間', days: 7, least: 7 },
  { label: '1ヶ月', days: DAYS_IN_MONTH, least: 31 }
]

/* How the histogram's rows are cut. A row a day is what the design draws and
   what a week or a month wants; a longer period would run off the box, so it
   is read at a coarser grain instead — a quarter by the week, half a year and
   anything longer by the month. It is one rule on the span's own length, so a
   range typed into SPECIFY THE PERIOD falls out the same way the twelve preset
   rows do. */
type Bucket = 'day' | 'week' | 'month'

function bucketFor(spanDays: number): Bucket {
  if (spanDays >= 180) return 'month'
  if (spanDays >= 84) return 'week'
  return 'day'
}

/** Penpot: "9999:99:99" — hours, minutes and seconds, each padded to two but
    the hours as long as they run. */
/** An average is a rate rather than a stopwatch, so it is written in hours and
    minutes — seconds on a figure divided by a month say nothing. */
function formatAverage(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h${pad2(minutes)}m`
}

function formatTotal(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

interface Slot {
  key: string
  /** Penpot: "07/26" — the run in the histogram's own 65px date column. */
  label: string
  /** The first and last day the row covers, as the keys the sessions carry. */
  from: string
  to: string
}

interface Props {
  games: GameWithStats[]
  /** The row SET DEFAULT was last pressed on, which is what the board opens
      on — the one thing about this screen that outlives it. */
  defaultPeriod: GraphPeriod
  /** The vocabulary the tag chips are matched against. */
  tags: Tag[]
  /** The groups the GROUP pill offers, which is the Home board's own list. */
  groups: Group[]
  onSetDefaultPeriod: (key: GraphPeriod) => void
  /** Back to the Calender board, which is what put this one up. */
  onBack: () => void
}

export default function PlaytimeGraph({
  games,
  defaultPeriod,
  tags,
  groups,
  onSetDefaultPeriod,
  onBack
}: Props): React.JSX.Element {
  const today = new Date()
  /* One of Penpot's twelve rows, or null while a range typed into SPECIFY THE
     PERIOD is the one on. */
  const [periodKey, setPeriodKey] = useState<GraphPeriod | null>(() => defaultPeriod)
  const [specified, setSpecified] = useState<{ from: Date; to: Date }>(() =>
    periodRow(defaultPeriod).range(new Date())
  )
  const [menuOpen, setMenuOpen] = useState(false)
  /* Penpot's own top-right Rectangle: which games the board counts at all.
     The two controls in it are the Home board's own — the Group pill and the
     ADD TAG + row — so a name is typed, settled and matched here exactly the
     way it is there.

     The Group field is two things. `groupText` is what is in it, which is what
     the suggestions are drawn from; `groupName` is the group the board is
     narrowed to, which follows on a row picked out of the menu, on Enter, or
     on the caret leaving the field. */
  const [groupText, setGroupText] = useState('')
  const [groupName, setGroupName] = useState('')
  /* The chips ADD TAG + puts out. They are a filter over the board and nothing
     else — a chip is a piece of text, and its ✕ takes it off the row. */
  const [tagFilters, setTagFilters] = useState<{ id: number; text: string }[]>([])
  const [newTagId, setNewTagId] = useState<number | null>(null)
  const nextTagId = useRef(1)
  /* Which of Penpot's "Menu" boards is out: 'group' is the whole list, dropped
     out of the pill by its ▼, and 'group-suggest' is that same list narrowed
     to what has been typed. */
  const [groupMenu, setGroupMenu] = useState<{
    key: 'group' | 'group-suggest'
    top: number
    left: number
  } | null>(null)
  const groupRef = useRef<HTMLDivElement | null>(null)
  const groupAnchorRef = useRef<HTMLElement | null>(null)
  const tagsRef = useRef<HTMLDivElement | null>(null)
  const [rows, setRows] = useState<DayGamePlaytime[]>([])
  /* Bumped whenever there is a different chart to draw, which is what runs the
     ring's arrival again — the same counter the Route board keeps. */
  const [reveal, setReveal] = useState(0)
  /* What is being pointed at — a wedge of the ring, or a row of the list
     beside it, which come to the same thing. A wedge puts its panel at the
     pointer; a row has no pointer worth following, so its panel goes to the
     middle of the ring and the wedge it names is drawn as though the pointer
     were on it. */
  const [hovered, setHovered] = useState<{
    gameId: number
    name: string
    color: string
    seconds: number
    /** In the pie's own 750 box; the render adds the column's own 118. */
    x: number
    y: number
    /** True when it was the list that asked, so the panel sits on the chart. */
    atPie: boolean
  } | null>(null)
  const pieRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null)
  /* False until the board slot's fade is over, which is what holds the ring
     and the bars back so the screen resolves before anything on it moves.
     True from the first frame while the Setting board's アニメーション row is
     off: there is no fade to come out of, and nothing to hold back. */
  const [arrived, setArrived] = useState(() => motionOff())

  useEffect(() => {
    if (motionOff()) return
    const id = window.setTimeout(() => setArrived(true), ARRIVAL_MS)
    return () => window.clearTimeout(id)
  }, [])

  // A chip added past the end of the row is scrolled to.
  useEffect(() => {
    if (newTagId === null) return
    const row = tagsRef.current
    if (row) row.scrollLeft = row.scrollWidth
  }, [newTagId])

  /* The row carries no scrollbar, so the wheel is the whole of how it moves. A
     vertical wheel over a box that only scrolls across does nothing in
     Chromium, and left alone it would scroll whatever is behind it instead —
     so the delta is turned sideways here and the event stopped. React's own
     `onWheel` is registered passive and cannot stop it, hence the native
     listener; the Home board's own tag row is the same. */
  useEffect(() => {
    const row = tagsRef.current
    if (!row) return
    const onWheel = (event: WheelEvent): void => {
      if (row.scrollWidth <= row.clientWidth) return
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      if (delta === 0) return
      event.preventDefault()
      // Line and page deltas, which some mice report, in pixels.
      const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1
      row.scrollLeft += delta * scale
    }
    row.addEventListener('wheel', onWheel, { passive: false })
    return () => row.removeEventListener('wheel', onWheel)
  }, [])

  /* What the period comes to. A preset answers with its own range given today;
     a specified one is the two dates as they were typed, either way round —
     the earlier of them is where the span starts. */
  const picked = periodKey ? periodRow(periodKey).range(today) : specified
  const spanFrom = picked.from <= picked.to ? picked.from : picked.to
  const spanTo = picked.from <= picked.to ? picked.to : picked.from
  const fromKey = toDateKey(spanFrom)
  const toKey = toDateKey(spanTo)
  /* Penpot writes the row's own name into the field in capitals. Girassol sets
     lowercase as small caps either way; the characters are the design's. */
  const periodLabel = periodKey ? periodRow(periodKey).label.toUpperCase() : 'SPECIFY THE PERIOD'

  /* One read for the whole board: the ring and its list add these up per game,
     the histogram per bucket, and its bars are the rows themselves. */
  useEffect(() => {
    let live = true
    window.library.getPlaytimeByDayAndGame(fromKey, toKey).then((answer) => {
      if (!live) return
      setRows(answer)
      setHovered(null)
      setReveal((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [fromKey, toKey])

  /* What the two fields on the top-right plate have left. They are the app's
     own three matches less the Search Box: a group whole (`matchesGroupName`)
     and a tag whole, from `filter.ts`, so a name means here exactly what it
     means on the side panel and the Home board. It narrows the *whole* board
     — the ring, the bars, the legend and the averages are all built off the
     rows this leaves. */
  const tagTerms = useMemo(
    /* Written chips only. A blank one is what ADD TAG + puts out for a name to
       be typed into, and it narrows nothing until there is one. */
    () => tagFilters.map((chip) => chip.text).filter((text) => text !== ''),
    [tagFilters]
  )

  const counted = useMemo(() => {
    if (!groupName && tagTerms.length === 0) return null
    return new Set(
      filterGames(games, tags, { query: '', group: groupName, tagTerms }).map((game) => game.id)
    )
  }, [games, tags, groupName, tagTerms])

  /* The rows the menu offers: the whole list under the ▼, with 「すべて」 over
     it for no group at all, and the names beginning with what has been typed
     under the field. The match is `filter.ts`'s own, so a menu here offers
     exactly the groups the Home board's would. */
  const groupOptions = useMemo(() => {
    if (!groupMenu) return []
    const rows = groups.map((group) => ({
      key: String(group.id),
      label: group.name,
      color: group.color
    }))
    if (groupMenu.key === 'group') return [{ key: ALL_GROUPS_KEY, label: t('すべて') }, ...rows]
    return rows.filter((row) => suggestsGroup(row.label, groupText))
  }, [groups, groupMenu, groupText])

  /* The list the ring and the legend share: the games played in the period,
     largest first. A game the library no longer has is left out — its sessions
     went with it, but a range read before a delete could still be in hand. */
  const perGame = new Map<number, number>()
  for (const row of rows) {
    if (counted && !counted.has(row.gameId)) continue
    perGame.set(row.gameId, (perGame.get(row.gameId) ?? 0) + row.seconds)
  }
  const played = [...perGame]
    .map(([gameId, seconds]) => ({
      gameId,
      seconds,
      game: games.find((one) => one.id === gameId)
    }))
    .filter((row) => row.game)
    .sort((a, b) => b.seconds - a.seconds)
    .map((row, index) => ({ ...row, color: colorForRank(index) }))
  const total = played.reduce((sum, row) => sum + row.seconds, 0)
  /** The colour a game is drawn in, which its own bars take too. */
  const inkFor = new Map(played.map((row) => [row.gameId, row.color]))

  const spanDays = Math.max(1, Math.round((spanTo.getTime() - spanFrom.getTime()) / 86400000) + 1)
  /* Penpot's own bottom-right Rectangle: what the period came to, at three
     lengths. One rate read three ways rather than three sums — a week is seven
     of the day's own average and a month is 365.25/12 of it — so the three
     figures can never disagree about the same period. */
  const perDay = total / spanDays
  const bucket = bucketFor(spanDays)
  const slots: Slot[] = []
  // A guard rather than a rule: no period the board offers reaches it.
  const LIMIT = 400
  if (bucket === 'day') {
    const at = new Date(spanFrom)
    while (at <= spanTo && slots.length < LIMIT) {
      const key = toDateKey(at)
      slots.push({
        key,
        label: `${pad2(at.getMonth() + 1)}/${pad2(at.getDate())}`,
        from: key,
        to: key
      })
      at.setDate(at.getDate() + 1)
    }
  } else if (bucket === 'week') {
    /* From the Sunday on or before the span's first day, which is the week the
       Calender board's own grid runs on. */
    const at = startOfWeek(spanFrom)
    while (at <= spanTo && slots.length < LIMIT) {
      const end = new Date(at)
      end.setDate(at.getDate() + 6)
      slots.push({
        key: toDateKey(at),
        label: `${pad2(at.getMonth() + 1)}/${pad2(at.getDate())}`,
        from: toDateKey(at),
        to: toDateKey(end)
      })
      at.setDate(at.getDate() + 7)
    }
  } else {
    const at = new Date(spanFrom.getFullYear(), spanFrom.getMonth(), 1)
    while (at <= spanTo && slots.length < LIMIT) {
      const end = new Date(at.getFullYear(), at.getMonth() + 1, 0)
      slots.push({
        key: `${at.getFullYear()}-${pad2(at.getMonth() + 1)}`,
        /* A month's row says which month of which year in the shape a day's
           row has, the year cut to its last two so it keeps the 65px column. */
        label: `${pad2(at.getFullYear() % 100)}/${pad2(at.getMonth() + 1)}`,
        from: toDateKey(at),
        to: toDateKey(end)
      })
      at.setMonth(at.getMonth() + 1)
    }
  }

  /* Each row is the sessions inside its own slot, cut into the games that made
     it, largest first. The design draws one flat bar; a bar in the games' own
     colours says which game the time went to as well as how long it was, so
     the two halves of the board read as one. */
  const bars = slots.map((slot) => {
    const parts = new Map<number, number>()
    for (const row of rows) {
      if (row.date < slot.from || row.date > slot.to) continue
      if (!inkFor.has(row.gameId)) continue
      parts.set(row.gameId, (parts.get(row.gameId) ?? 0) + row.seconds)
    }
    const list = [...parts]
      .map(([gameId, seconds]) => ({ gameId, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
    return { ...slot, parts: list, total: list.reduce((sum, part) => sum + part.seconds, 0) }
  })
  const longestSlot = Math.max(1, ...bars.map((row) => row.total))

  /** `.graph-pie` is 750 design px wide, which is what recovers the shell's own
      scale — the same conversion the Route board's own pie makes. */
  function trackPointer(key: string, event: React.MouseEvent): void {
    const box = pieRef.current?.getBoundingClientRect()
    const row = played.find((one) => String(one.gameId) === key)
    if (!box || box.width <= 0 || !row) return
    const scale = box.width / PIE_SIZE
    setHovered({
      gameId: row.gameId,
      name: displayName(row.game!),
      color: row.color,
      seconds: row.seconds,
      // Below and to the right of the pointer, the way the Route board's is.
      x: (event.clientX - box.left) / scale + 14,
      y: (event.clientY - box.top) / scale + 14,
      atPie: false
    })
  }

  /** A range typed anywhere — the menu's own date rows or either stamp — takes
      the board off the twelve preset rows and onto that span. */
  function specify(from: Date, to: Date): void {
    setPeriodKey(null)
    setSpecified({ from, to })
  }

  function toggleMenu(): void {
    const board = boardRef.current
    const row = anchorRef.current
    if (!board || !row) return
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const boardRect = board.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const scale = boardRect.width / BOARD_WIDTH
    setMenuAt({
      top: (rect.bottom - boardRect.top) / scale,
      left: (rect.left - boardRect.left) / scale
    })
    setMenuOpen(true)
  }

  /* Where the group menu hangs, in the board's own design pixels — measured
     when the pill is opened rather than written down, the way the Home board's
     own is, since `position: fixed` and `getBoundingClientRect` do not share
     the shell's coordinate space. */
  function placeGroupMenu(key: 'group' | 'group-suggest', row: HTMLElement): void {
    const board = boardRef.current
    if (!board) return
    const boardRect = board.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const scale = boardRect.width / BOARD_WIDTH
    groupAnchorRef.current = row
    setGroupMenu({
      key,
      top: (rect.bottom - boardRect.top) / scale + MENU_GAP,
      left: (rect.left - boardRect.left) / scale
    })
  }

  function toggleGroupMenu(row: HTMLElement): void {
    if (groupMenu?.key === 'group') {
      setGroupMenu(null)
      return
    }
    placeGroupMenu('group', row)
  }

  /* The suggestions hang off the whole pill rather than off the field, so they
     line up with the list the ▼ drops out of it. A field holding only spaces
     has nothing in it: it puts no suggestions up, and — `filterGames` trimming
     what it is given — narrows the board by nothing either. */
  function openGroupSuggestions(text: string): void {
    const row = groupRef.current
    if (!row) return
    if (text.trim()) placeGroupMenu('group-suggest', row)
    else setGroupMenu((open) => (open?.key === 'group-suggest' ? null : open))
  }

  /** Settles the field: what it holds becomes what the board is narrowed to. */
  function commitGroup(text: string): void {
    setGroupText(text)
    setGroupName(text)
  }

  function addTag(): void {
    const id = nextTagId.current++
    setTagFilters((list) => [...list, { id, text: '' }])
    setNewTagId(id)
  }

  /* The name a chip was left holding. Nothing in it takes the chip away —
     **and so does a name the row already carries**: a tag is one condition on
     the list, and the same one twice narrows nothing further while standing
     there as though it did. Case is ignored because the match ignores it
     (`filterGames` lowercases both sides), so "RPG" over "rpg" would have been
     the one condition written twice. */
  function commitTag(id: number, text: string): void {
    const trimmed = text.trim()
    setNewTagId((current) => (current === id ? null : current))
    setTagFilters((list) => {
      const repeats = list.some(
        (chip) => chip.id !== id && chip.text.toLowerCase() === trimmed.toLowerCase()
      )
      if (trimmed === '' || repeats) return list.filter((chip) => chip.id !== id)
      return list.map((chip) => (chip.id === id ? { ...chip, text: trimmed } : chip))
    })
  }

  function deleteTag(id: number): void {
    setNewTagId((current) => (current === id ? null : current))
    setTagFilters((list) => list.filter((chip) => chip.id !== id))
  }

  return (
    <div className="graph-board" ref={boardRef}>
      {/* Penpot: Left — the period, its preset and the histogram */}
      <div className="graph-left">
        {/* The two stamps are typed into as well as read: a figure clicked is
            a figure edited, and what comes out of it is a specified range the
            same as one typed into the menu's own date rows. */}
        <div className="graph-period">
          <DayStamp
            day={spanFrom}
            className="from"
            onChange={(next) => specify(next, spanTo)}
          />
          <span className="graph-arrow">»</span>
          <DayStamp day={spanTo} className="to" onChange={(next) => specify(spanFrom, next)} />
        </div>

        {/* Penpot: Under Line — the bar and the taper past it */}
        <div className="graph-underline">
          <div className="graph-underline-bar" />
          <div className="graph-underline-taper" />
        </div>

        {/* Penpot: Period Setting — the field and its ▼, one control */}
        <div className="graph-period-setting" ref={anchorRef}>
          <button className="graph-period-field" onClick={toggleMenu} title={t('期間を選ぶ')}>
            {periodLabel}
          </button>
          <button className="graph-period-caret" onClick={toggleMenu} aria-label={t('期間を選ぶ')}>
            ▼
          </button>
        </div>

        {/* Penpot: Histgram — a date column, the rule, and the bars past it. */}
        <div className={`graph-histogram${arrived ? ' armed' : ''}`}>
          <div className="graph-histogram-days">
            {bars.map((row) => (
              <div className="graph-histogram-row" key={row.key}>
                <span className="graph-histogram-date">{row.label}</span>
                <div className="graph-histogram-track">
                  {/* The row's own length, cut into the games that made it. The
                      bar is a fraction of what the track leaves once the figure
                      at its end has been given its room. */}
                  <div
                    className="graph-histogram-fill"
                    style={{
                      width: `calc((100% - ${HISTOGRAM_TIME_COLUMN}px) * ${
                        row.total / longestSlot
                      })`
                    }}
                  >
                    {row.parts.map((part) => (
                      <div
                        key={part.gameId}
                        className="graph-histogram-bar"
                        style={{
                          width: `${(part.seconds / row.total) * 100}%`,
                          background: inkFor.get(part.gameId)
                        }}
                        title={`${displayName(
                          played.find((one) => one.gameId === part.gameId)!.game!
                        )} — ${formatTotal(part.seconds)}`}
                      />
                    ))}
                  </div>
                  {/* Not in the design, which draws a bar and no figure: what
                      the row came to, written at the end of its own bar so it
                      moves with it rather than standing in a column of its own. */}
                  {row.total > 0 && (
                    <span className="graph-histogram-time">
                      <span className="hours">{Math.floor(row.total / 3600)}h</span>
                      <span className="minutes">{Math.floor((row.total % 3600) / 60)}m</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="graph-histogram-rule" />
        </div>

        {/* Not in the design: the way back to the board that put this one up. */}
        <button className="graph-back" onClick={onBack}>
          <span className="graph-back-arrow">◀</span>
          <span className="graph-back-word">Calender</span>
        </button>
      </div>

      {/* Penpot: Middle — the Pie Chart with the total written over it. It is
          the Route board's ring at this board's own 750: the same wedges, the
          same arrival and the same hover. */}
      <div className="graph-middle">
        <div className={`graph-pie ${total > 0 ? 'charted' : ''}`} ref={pieRef}>
          <PieChart
            slices={played.map((row) => ({
              key: String(row.gameId),
              color: row.color,
              share: row.seconds / total
            }))}
            size={PIE_SIZE}
            reveal={reveal}
            ready={arrived}
            /* Whatever is being pointed at, from wherever — a wedge or a row
               of the list. The one asked about is lit and the rest held back. */
            highlight={hovered ? String(hovered.gameId) : null}
            onSliceHover={(key, event) => trackPointer(key, event)}
            onSliceLeave={() => setHovered(null)}
          />
          {/* Penpot writes the total across the middle in the board's own dark,
              which is what a flat plate needs. The ring leaves a hole there
              instead, so it is set in the app's text the way the Route board's
              own total is. */}
          <div className={`graph-pie-label${hovered?.atPie ? ' covered' : ''}`}>
            <span className="title">TOTAL PLAY TIME</span>
            <span className="total">{formatTotal(total)}</span>
          </div>
        </div>

        {/* Penpot: Hover Pie Game — 375x136, the name and time of whatever is
            being pointed at. Asked for by a wedge, it stays at the pointer's
            lower right and nothing pulls it back: the pointer is measured
            against the pie and the panel hangs off the column the pie sits 118
            down, so that offset is all that is added. A wedge at the ring's
            right edge puts it past the board, which is where it belongs — held
            inside instead, it would jump out from under the pointer that is
            asking for it. Asked for by a row of the list, it goes to the middle
            of the ring instead: the pointer is over on the far side of the
            board and has nothing to do with where the answer belongs. */}
        {hovered && (
          <div
            className={`graph-hover${hovered.atPie ? ' at-pie' : ''}`}
            /* The pointer's own panel is placed where the pointer is; the ring's
               is placed by its own middle from the sheet, being as tall as its
               name needs. */
            style={
              hovered.atPie
                ? undefined
                : { left: `${hovered.x}px`, top: `${hovered.y + PIE_TOP}px` }
            }
          >
            {hovered.atPie ? (
              <FitName text={hovered.name} color={hovered.color} />
            ) : (
              <span className="graph-hover-name" style={{ color: hovered.color }}>
                {hovered.name}
              </span>
            )}
            <span className="graph-hover-time">{formatTotal(hovered.seconds)}</span>
          </div>
        )}
      </div>

      {/* Penpot: Right — the game list between its two rules */}
      <div className="graph-right">
        <div className="graph-right-rule top" />
        <div className="graph-game-list">
          {played.map((row, index) => (
            /* The key carries the period as well as the game, so a list asked a
               different question is a new list and arrives again rather than
               the rows that happen to be in both standing still. */
            <LegendRow
              key={`${fromKey}:${toKey}:${row.gameId}`}
              delay={ARRIVAL_MS + Math.min(index * LEGEND_STEP_MS, LEGEND_STEP_MAX_MS)}
              onEnter={() =>
                setHovered({
                  gameId: row.gameId,
                  name: displayName(row.game!),
                  color: row.color,
                  seconds: row.seconds,
                  x: (PIE_SIZE - HOVER_W) / 2,
                  y: (PIE_SIZE - HOVER_H) / 2,
                  atPie: true
                })
              }
              onLeave={() => setHovered(null)}
            >
              <span className="graph-game-color" style={{ background: row.color }} />
              <span className="graph-game-name">{displayName(row.game!)}</span>
              <span className="graph-game-share">{((row.seconds / total) * 100).toFixed(1)}%</span>
            </LegendRow>
          ))}
        </div>
        <div className="graph-right-rule bottom" />
      </div>

      {/* Penpot: Rectangle — 1117x50 at 468/935, the plate at the board's
          foot. The design draws it and nothing in it; what it holds is the
          Home board's own two filters, divided by the same rule, which say
          which games this board counts at all. */}
      <div className="graph-filters">
        {/* The Group pill: the ▼ drops the whole list out of the row, typing
            narrows that same board to the names beginning with what has been
            typed, and the board is narrowed to the group of exactly that
            name. Penpot's own "GROUP" is what the field says while nothing is
            in it. */}
        <div className="graph-filter-half">
          <div className="graph-select" ref={groupRef}>
            <span className="graph-select-value">
              <input
                className="graph-select-input"
                placeholder="GROUP"
                value={groupText}
                spellCheck={false}
                onChange={(event) => {
                  /* A blank is nothing typed: a field holding only spaces goes
                     back to being empty, so it says GROUP again rather than
                     standing there looking filled in while it narrows the
                     board by nothing. Only a run that is *all* whitespace
                     goes — a space inside a name is part of the name. */
                  const text = event.target.value.trim() ? event.target.value : ''
                  if (text) setGroupText(text)
                  else commitGroup('')
                  openGroupSuggestions(text)
                }}
                onKeyDown={(event) => {
                  /* Enter settles the field. Not the Enter that ends an IME
                     conversion, though — that one is choosing a character, and
                     a group written in Japanese would otherwise be searched
                     for one syllable at a time. */
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                  commitGroup(groupText)
                  setGroupMenu(null)
                }}
                onFocus={() => openGroupSuggestions(groupText)}
                onBlur={() => {
                  commitGroup(groupText)
                  setGroupMenu((open) => (open?.key === 'group-suggest' ? null : open))
                }}
              />
            </span>
            <button
              className="graph-select-caret"
              onClick={(event) => toggleGroupMenu(event.currentTarget.parentElement!)}
              title={t('グループ一覧')}
              aria-label={t('グループ一覧')}
              aria-haspopup="menu"
              aria-expanded={groupMenu !== null}
            >
              {/* ▲ rather than the ▼ every other one of these carries: the
                  plate stands on the footer, so this list has nowhere to go
                  but up and always opens above the row. The mark says which
                  way the press goes. */}
              <span className="graph-caret-glyph">▲</span>
            </button>
          </div>
        </div>

        <span className="graph-filter-rule" />

        {/* The tag half is the Home board's own row: ADD TAG + puts out a
            chip, named in place, and every written one is a condition on the
            whole board. A tag is matched whole, the way it is everywhere
            else. */}
        <div className="graph-filter-half tags">
          <button className="graph-add-tag" onClick={addTag}>
            <span className="graph-chip-label">ADD TAG +</span>
          </button>
          <span className="graph-tag-rule" />
          <div className="graph-tag-container" ref={tagsRef}>
            {tagFilters.map((chip) => (
              <TagChip
                key={chip.id}
                name={chip.text}
                editing={chip.id === newTagId}
                onCommit={(text) => commitTag(chip.id, text)}
                onDelete={() => deleteTag(chip.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Penpot: Rectangle — 600x50 at 986/0, the plate at the board's head.
          What it holds is what the period came to per day, per week and per
          month. */}
      <div className="graph-averages">
        <span className="graph-average-title">{t('平均:')}</span>
        {/* The three figures are a box of their own, which is what lets the
            air on either side of them be the one figure (see the sheet). */}
        <div className="graph-average-units">
          {AVERAGE_UNITS.map((unit) => (
            <div className="graph-average" key={unit.label}>
              <span className="graph-average-label">{t(unit.label)}</span>
              <span className="graph-average-value">
                {/* A period no longer than the unit puts the whole of itself
                    into one of them, so the figure would be the total written
                    again rather than an average of anything. */}
                {spanDays <= unit.least ? '--' : formatAverage(perDay * unit.days)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* No rows, no board: a search matching no group puts nothing up rather
          than an empty plate, which is what every other one of these does. */}
      {groupMenu && groupOptions.length > 0 && (
        <OptionMenu
          options={groupOptions}
          top={groupMenu.top}
          left={groupMenu.left}
          width={GROUP_WIDTH}
          /* The groups are what the list is of; the 「すべて」 row over them is
             not one of them, and the suggestions leave it off entirely. */
          maxRows={GROUP_MENU_ROWS + (groupOptions[0]?.key === ALL_GROUPS_KEY ? 1 : 0)}
          onPick={(key) => {
            if (key === ALL_GROUPS_KEY) commitGroup('')
            else {
              const picked = groups.find((group) => String(group.id) === key)
              if (picked) commitGroup(picked.name)
            }
            setGroupMenu(null)
          }}
          onDismiss={() => setGroupMenu(null)}
          anchorRef={groupAnchorRef as React.RefObject<HTMLElement>}
        />
      )}

      {menuOpen && menuAt && (
        <PeriodMenu
          current={periodKey}
          defaultKey={defaultPeriod}
          from={spanFrom}
          to={spanTo}
          top={menuAt.top}
          left={menuAt.left}
          anchorRef={anchorRef}
          onPick={(key) => {
            setPeriodKey(key)
            setMenuOpen(false)
          }}
          /* SET DEFAULT stores the row and puts the board on it, the menu
             staying up: pressing it is saying which period this screen opens
             on, which is worth seeing land. */
          onSetDefault={(key) => {
            setPeriodKey(key)
            onSetDefaultPeriod(key)
          }}
          onSpecify={specify}
          onDismiss={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}

/* Not in the design: a row of the list answers the pointer the way its own
   wedge does — the plate lifts, the wedge is lit and the rest of the ring held
   back, and the panel comes up on the chart.

   **It carries that same plate the whole way in**, and gives it up when its
   arrival is over: the row comes up already lit and settles, which draws the
   eye down the list in the order it is filling. The plate cannot come out of
   the keyframes — a filled animation's last frame outranks every ordinary
   declaration, so a `background` left there would beat the hover rule for good
   afterwards — so it is a class the row takes off on its own `animationend`,
   and the 0.15s transition it already has fades it out from there. */
function LegendRow({
  delay,
  onEnter,
  onLeave,
  children
}: {
  delay: number
  onEnter: () => void
  onLeave: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const [arriving, setArriving] = useState(true)

  return (
    <div
      className={`graph-game${arriving ? ' arriving' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
      onAnimationEnd={() => setArriving(false)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  )
}

/* Where a two-line name is allowed to come apart. Chromium's rule for Japanese
   is that a line may end between very nearly any two characters, so a title
   broke in the middle of a word and read as a mistake rather than as a long
   name. These are the places a reader would break one instead: at a space,
   around a bracket, after a mark that is already a separator, and at a change
   of script, which in Japanese is where one word tends to end and the next
   begin. */
const NAME_OPENERS = '「『（〔［【《〈｛(['
const NAME_CLOSERS = '」』）〕］】》〉｝)]'
const NAME_MARKS = '・/／｜|：:；;，,、。．.！!？?〜~＆&＋+－—―–-'
/* Kinsoku: a closing bracket, a mark, a small kana or a 長音符 belongs to the
   line the character before it is on and can never start one of its own. */
const NAME_NO_START = NAME_CLOSERS + NAME_MARKS + 'ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々'

type NameScript = 'latin' | 'digit' | 'hira' | 'kata' | 'han' | 'other'

function nameScript(ch: string): NameScript {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x3041 && code <= 0x309f) return 'hira'
  if ((code >= 0x30a1 && code <= 0x30fa) || code === 0x30fd || code === 0x30fe) return 'kata'
  if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || code === 0x3005)
    return 'han'
  if ((code >= 0x30 && code <= 0x39) || (code >= 0xff10 && code <= 0xff19)) return 'digit'
  if (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0xc0 && code <= 0x24f) ||
    (code >= 0xff21 && code <= 0xff3a) ||
    (code >= 0xff41 && code <= 0xff5a)
  )
    return 'latin'
  return 'other'
}

/** Every place the name may be broken, with how good a place it is: 0 for a
    mark that is already a separator, 1 for a kana ending a word, 2 for any
    other change of script. */
function nameBreaks(text: string): { at: number; tier: number }[] {
  /* A 長音符 is part of the run it stands in rather than a script of its own,
     so it takes the class of what is before it — ドール is one word. */
  const scripts: NameScript[] = []
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    scripts.push(ch === 'ー' || ch === 'ｰ' ? scripts[index - 1] ?? 'other' : nameScript(ch))
  }

  const breaks: { at: number; tier: number }[] = []
  for (let at = 1; at < text.length; at += 1) {
    const prev = text[at - 1]
    const cur = text[at]
    if (cur === ' ' || cur === '　') continue
    if (NAME_NO_START.includes(cur)) continue
    if (NAME_OPENERS.includes(prev)) continue
    let tier = -1
    if (prev === ' ' || prev === '　') tier = 0
    else if (NAME_CLOSERS.includes(prev) || NAME_MARKS.includes(prev)) tier = 0
    else if (NAME_OPENERS.includes(cur)) tier = 0
    else if (scripts[at - 1] !== scripts[at]) {
      /* Hiragana after a word is its okurigana or the particle holding it to
         the next one, so it is never left to start a line by itself. */
      if (scripts[at] === 'hira') continue
      tier = scripts[at - 1] === 'hira' ? 1 : 2
    }
    if (tier >= 0) breaks.push({ at, tier })
  }
  return breaks
}

/** The size the name is measured at. What is compared is one width against
    another, so the probe stands outside the shell and its zoom scales both. */
const HOVER_NAME_REF = 200
/** How much of a size step a better break is worth, in px of font size. */
const NAME_TIER_COST = 3

interface NameLayout {
  size: number
  lines: string[]
  maxLines: number
}

function layoutName(text: string): NameLayout {
  const probe = document.createElement('span')
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-display')
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;' +
    `font-family:${family};font-size:${HOVER_NAME_REF}px;`
  document.body.appendChild(probe)
  const widthOf = (run: string): number => {
    probe.textContent = run
    return probe.getBoundingClientRect().width
  }
  const sizeFor = (width: number): number =>
    width > 0 ? (HOVER_NAME_REF * HOVER_NAME_WIDTH) / width : HOVER_NAME_MAX

  try {
    const whole = sizeFor(widthOf(text))
    if (whole >= HOVER_NAME_MAX) return { size: HOVER_NAME_MAX, lines: [text], maxLines: 1 }

    let best: { size: number; score: number; lines: string[] } | null = null
    for (const { at, tier } of nameBreaks(text)) {
      const head = text.slice(0, at).trimEnd()
      const tail = text.slice(at).trimStart()
      if (!head || !tail) continue
      const headWidth = widthOf(head)
      const tailWidth = widthOf(tail)
      const size = Math.min(HOVER_NAME_MAX, Math.floor(sizeFor(Math.max(headWidth, tailWidth))))
      if (size < HOVER_NAME_MIN) continue
      /* The largest the two lines can be set at, less a size step or two for a
         poorer place to break — a break in the middle of a word is not paid for
         by a point of type — and, where two breaks come to the same, the one
         that leaves the two lines nearest the same length. Most of a title fits
         at the cap either way, so without that last the first break in the name
         won and a long run was left hanging under one short word. */
      const balance = Math.abs(headWidth - tailWidth) / (headWidth + tailWidth)
      const score = size - tier * NAME_TIER_COST - balance
      if (!best || score > best.score) best = { size, score, lines: [head, tail] }
    }
    if (best) return { size: best.size, lines: best.lines, maxLines: 2 }

    /* Nothing in the name to break on — one long run of the same script with no
       mark in it — so the browser wraps it where it will, at a size two lines
       hold with something in hand for where that break lands. */
    return {
      size: Math.max(HOVER_NAME_MIN, Math.min(HOVER_NAME_MAX, Math.floor(whole * 1.85))),
      lines: [text],
      maxLines: 2
    }
  } finally {
    probe.remove()
  }
}

/* The name in the middle of the ring, set as large as it can be and still be
   read whole. One line at the cap if the run fits there; otherwise two, at the
   largest size those two hold — and broken where a reader would break it
   rather than wherever the line happens to run out. The size and the height it
   comes to are written inline: nothing else knows how long a game's name is. */
function FitName({ text, color }: { text: string; color: string }): React.JSX.Element {
  const { size, lines, maxLines } = useMemo(() => layoutName(text), [text])

  return (
    <span
      className="graph-hover-name"
      style={{
        color,
        maxWidth: `${HOVER_NAME_WIDTH}px`,
        fontSize: `${size}px`,
        // Two lines and no more, whatever the name turns out to be.
        maxHeight: `${Math.ceil(size * HOVER_NAME_LINE * maxLines)}px`,
        overflow: 'hidden'
      }}
    >
      {lines.map((line, index) => (
        <span className="graph-hover-line" key={index}>
          {line}
        </span>
      ))}
    </span>
  )
}

/* Penpot: Start Day — the month over the year, the day dropped below a great
   slash, and the weekday small beside it. Three of the four are typed over in
   place: the design draws a stamp that only reads, but it is the one thing on
   the board that says what the period is, so it is also where one is set. The
   weekday is not among them — it follows from the other three. */
type DayPartName = 'month' | 'date' | 'year'

function DayStamp({
  day,
  className,
  onChange
}: {
  day: Date
  className: string
  onChange: (next: Date) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<DayPartName | null>(null)

  /* A figure typed over the run it replaces, the other two left as they are.
     Anything that is not a date is simply not taken — the stamp goes back to
     what it was rather than reporting something the calendar cannot hold. */
  function commit(part: DayPartName, text: string): void {
    setEditing(null)
    const typed = Number(text.trim())
    if (!Number.isInteger(typed)) return
    const year = part === 'year' ? typed : day.getFullYear()
    const month = part === 'month' ? typed - 1 : day.getMonth()
    const date = part === 'date' ? typed : day.getDate()
    if (year < FIRST_YEAR || year > LAST_YEAR) return
    if (month < 0 || month > 11) return
    if (date < 1 || date > new Date(year, month + 1, 0).getDate()) return
    onChange(new Date(year, month, date))
  }

  return (
    <div className={`graph-day ${className}`}>
      <DayPart
        className="graph-day-month"
        text={pad2(day.getMonth() + 1)}
        active={editing === 'month'}
        onOpen={() => setEditing('month')}
        onClose={() => setEditing(null)}
        onCommit={(text) => commit('month', text)}
      />
      {/* Penpot sets a fullwidth solidus here and rasters it as a thin, even
          diagonal running most of the box's height. Set as text it is whatever
          the runtime's fallback answers with — Chromium's is a short tapered
          serif slash that lands across the year — so the mark is drawn
          instead, the way the gear on the Main Image is: by geometry, off the
          design's own raster, rather than by whichever font happens to have
          the character. */}
      <svg className="graph-day-slash" viewBox="0 0 151 101" aria-hidden="true">
        <line x1="60" y1="83.3" x2="101" y2="5.7" />
      </svg>
      <DayPart
        className="graph-day-date"
        text={pad2(day.getDate())}
        active={editing === 'date'}
        onOpen={() => setEditing('date')}
        onClose={() => setEditing(null)}
        onCommit={(text) => commit('date', text)}
      />
      <DayPart
        className="graph-day-year"
        text={String(day.getFullYear())}
        active={editing === 'year'}
        onOpen={() => setEditing('year')}
        onClose={() => setEditing(null)}
        onCommit={(text) => commit('year', text)}
      />
      <span className="graph-day-weekday">{WEEKDAYS[day.getDay()]}</span>
    </div>
  )
}

/* One of a stamp's three figures: the run as drawn until it is clicked, and the
   same run as a field after that. Settled on blur or Enter. Escape flags the
   cancel rather than writing the old text back into the field — the blur that
   follows commits what the field was *rendered* with, which is the trap the
   Add Game dialog's tag chips already fell into. */
function DayPart({
  className,
  text,
  active,
  onOpen,
  onClose,
  onCommit
}: {
  className: string
  text: string
  active: boolean
  onOpen: () => void
  onClose: () => void
  onCommit: (text: string) => void
}): React.JSX.Element {
  const cancelled = useRef(false)

  if (!active) {
    return (
      <button type="button" className={`${className} graph-day-run`} onClick={onOpen} title={t('編集')}>
        {text}
      </button>
    )
  }
  return (
    <input
      className={`${className} graph-day-input`}
      defaultValue={text}
      inputMode="numeric"
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => {
        if (cancelled.current) {
          cancelled.current = false
          onClose()
          return
        }
        onCommit(event.currentTarget.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancelled.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}
