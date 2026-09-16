import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameWithStats, Language, LedgerEntry, LedgerKind } from '../../../shared/db-types'
import { colorForRank } from '../color'
import { useContextMenuDismiss } from '../context-menu'
import { t } from '../../../shared/i18n'
import { mediaUrl } from '../../../shared/media-url'
import { displayName } from '../sort'
import ConfirmDialog from './ConfirmDialog'
import ContextMenu from './ContextMenu'
import OptionMenu from './OptionMenu'
import { DateRow } from './PeriodMenu'
import './PeriodMenu.css'
import PieChart from './PieChart'
import './Ledger.css'

/** How long the board's own movements are still on their way in, which is
    when it clips what has not landed. */
const ARRIVAL_MS = 250
const ARRIVAL_CLIP_MS = 1000
/** The graph's own legend stagger, so the list arrives the same way. */
const LEGEND_STEP_MS = 35
const LEGEND_STEP_MAX_MS = 500

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const pad2 = (n: number): string => String(n).padStart(2, '0')
/** Penpot: the Pie Chart is drawn at 750. */
const PIE_SIZE = 750
/** The board's own design width, which a right press is placed against. */
const BOARD_WIDTH = 1585
/** The years a date typed into a stamp may reach, the Calender board's own. */
const FIRST_YEAR = 1980
const LAST_YEAR = 2100
const CONTEXT_MENU_WIDTH = 201
const CONTEXT_MENU_HEIGHT = 10 + 42 * 2 + 5 + 10

/** A local YYYY-MM-DD, the shape the entries and the day stamps share. */
function isoDate(day: Date): string {
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`
}
function fromIso(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** The periods the field offers — this/last week, month and year, all time,
    and a range the player sets themselves, the way the PlayTime Graph's own
    period does. */
type Period =
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'this-half-year'
  | 'last-half-year'
  | 'this-year'
  | 'last-year'
  | 'all'
  | 'custom'
const PERIODS: { key: Period; label: string }[] = [
  { key: 'this-week', label: 'THIS WEEK' },
  { key: 'last-week', label: 'LAST WEEK' },
  { key: 'this-month', label: 'THIS MONTH' },
  { key: 'last-month', label: 'LAST MONTH' },
  { key: 'this-half-year', label: 'THIS HALF YEAR' },
  { key: 'last-half-year', label: 'LAST HALF YEAR' },
  { key: 'this-year', label: 'THIS YEAR' },
  { key: 'last-year', label: 'LAST YEAR' },
  { key: 'all', label: 'ALL TIME' },
  { key: 'custom', label: 'SPECIFY THE PERIOD' }
]

function periodRange(
  period: Period,
  entries: { date: string }[],
  custom: [string, string]
): [Date, Date] {
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const weekStart = (base: Date): Date =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay())
  if (period === 'this-week') {
    const start = weekStart(end)
    return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)]
  }
  if (period === 'last-week') {
    const start = weekStart(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7))
    return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)]
  }
  if (period === 'this-month') {
    return [
      new Date(end.getFullYear(), end.getMonth(), 1),
      new Date(end.getFullYear(), end.getMonth() + 1, 0)
    ]
  }
  if (period === 'last-month') {
    return [
      new Date(end.getFullYear(), end.getMonth() - 1, 1),
      new Date(end.getFullYear(), end.getMonth(), 0)
    ]
  }
  if (period === 'this-half-year') {
    // Jan–Jun or Jul–Dec, whichever half today is in.
    const first = end.getMonth() < 6
    return [
      new Date(end.getFullYear(), first ? 0 : 6, 1),
      new Date(end.getFullYear(), first ? 5 : 11, first ? 30 : 31)
    ]
  }
  if (period === 'last-half-year') {
    // The half before this one — the other half of this year, or the second
    // half of last year when today is in the first half.
    const first = end.getMonth() < 6
    if (first) {
      return [new Date(end.getFullYear() - 1, 6, 1), new Date(end.getFullYear() - 1, 11, 31)]
    }
    return [new Date(end.getFullYear(), 0, 1), new Date(end.getFullYear(), 5, 30)]
  }
  if (period === 'this-year') {
    return [new Date(end.getFullYear(), 0, 1), new Date(end.getFullYear(), 11, 31)]
  }
  if (period === 'last-year') {
    return [new Date(end.getFullYear() - 1, 0, 1), new Date(end.getFullYear() - 1, 11, 31)]
  }
  if (period === 'custom') {
    // The earlier of the two typed dates is where it starts, either way round.
    const a = fromIso(custom[0])
    const b = fromIso(custom[1])
    return a <= b ? [a, b] : [b, a]
  }
  // all: the earliest entry (or today) to today.
  const earliest = entries.reduce<string | null>(
    (min, entry) => (min === null || entry.date < min ? entry.date : min),
    null
  )
  return [earliest ? fromIso(earliest) : end, end]
}

/** ¥100,000 / -＄100 — the design's own grouping, the mark the app's currency
    (¥, or ＄ under ENG); a negative net carries its sign before the mark. */
function formatMoney(amount: number, language: Language): string {
  const mark = language === 'en' ? '$' : '¥'
  const rounded = Math.round(amount)
  const sign = rounded < 0 ? '-' : ''
  return `${sign}${mark}${Math.abs(rounded).toLocaleString('en-US')}`
}

/** A row the board counts: either one of `ledger_entries` (source 'ledger',
    with its id) or a game's own purchase from the Add Game panel (source
    'purchase', no id — the game's field, not a deletable row). */
interface MergedEntry {
  id: number | null
  gameId: number | null
  kind: LedgerKind
  price: number
  date: string
  source: 'ledger' | 'purchase'
}

interface Props {
  games: GameWithStats[]
  language: Language
}

/**
 * Penpot board "Ledger" (103d7b69-a8a6-80ba-8008-a2ba06bea01c), 1585x986 — the
 * Extra Function board's 帳簿 puts it up. It keeps a book of games bought and
 * sold: the Buy / Sell Box on the Left adds an entry (a game, a price, a day,
 * as a BUY or a SELL), the Period narrows what is counted, the Middle's Pie
 * Chart and the Right's Game List are the per-game totals over that period —
 * the ☑ BUY / ☑ SELL pair saying which kinds are in them — and the two plates
 * are the totals spent and sold over the *entire* period, whatever the row
 * above is set to.
 *
 * **This is a first pass read off the design alone.** What the board draws is
 * wired up; what it does not draw — an entry once made cannot yet be taken off
 * from a visible control, so a mistaken row is removed with a right press on
 * the Game List, which is the one deletion affordance the app uses everywhere.
 */
export default function Ledger({ games, language }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [period, setPeriod] = useState<Period>('this-month')
  const [periodMenu, setPeriodMenu] = useState(false)
  const periodRef = useRef<HTMLDivElement | null>(null)
  /* Held while the board's own arrivals run, so what has not landed — the
     Buy / Sell Box rising from below most of all — is clipped to the board
     rather than drawn on the footer. */
  const [clipping, setClipping] = useState(true)
  /* The range SPECIFY THE PERIOD sets — opens on this week's ends. */
  const [custom, setCustom] = useState<[string, string]>(() => {
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
    return [
      isoDate(start),
      isoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))
    ]
  })

  /* The form: which kind of entry is being added, and its three fields. */
  const [kind, setKind] = useState<LedgerKind>('buy')
  const [formGameId, setFormGameId] = useState<number | null>(null)
  const [gameMenu, setGameMenu] = useState(false)
  const gameRef = useRef<HTMLDivElement | null>(null)
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(isoDate(new Date()))
  const [error, setError] = useState<string | null>(null)

  /* Which kinds the pie and the list count, and which slice is being pointed
     at from either of them. */
  const [includeBuy, setIncludeBuy] = useState(true)
  const [includeSell, setIncludeSell] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  /* The cursor-following tooltip, the way the PlayTime Graph's Hover Pie Game
     panel is: what the pointer is over, and where it is in the board's own
     design pixels. */
  const [hoverInfo, setHoverInfo] = useState<{
    name: string
    amount: string
    kind: LedgerKind
    color: string
    x: number
    y: number
  } | null>(null)
  const boardRef = useRef<HTMLElement | null>(null)
  const [reveal, setReveal] = useState(0)

  const [menu, setMenu] = useState<{
    gameId: number | null
    kind: LedgerKind
    left: number
    top: number
  } | null>(null)
  const menuOpener = useContextMenuDismiss(menu !== null, () => setMenu(null))
  const [deleting, setDeleting] = useState<{
    gameId: number | null
    kind: LedgerKind
    name: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.library.listLedgerEntries().then((list) => {
      if (!cancelled) setEntries(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The board stops clipping once everything has arrived.
  useEffect(() => {
    const id = window.setTimeout(() => setClipping(false), ARRIVAL_CLIP_MS)
    return () => window.clearTimeout(id)
  }, [])

  const gameName = useCallback(
    (id: number | null): string => {
      const game = id === null ? undefined : games.find((one) => one.id === id)
      return game ? displayName(game) : '---'
    },
    [games]
  )
  const gameIcon = useCallback(
    (id: number | null): string | null => {
      const game = id === null ? undefined : games.find((one) => one.id === id)
      return game?.iconPath ? mediaUrl(game.iconPath) : null
    },
    [games]
  )

  /* **A game bought through the Add Game dialog's advanced panel is a BUY in
     the book too.** `games.purchase_price` is a purchase this app already
     knows about, so it is read here as a synthetic buy — dated by
     `purchase_date`, or the day the game was registered where the panel left
     that blank — beside the entries the Buy / Sell Box wrote. It carries no
     ledger id, being the game's own field rather than a row of
     `ledger_entries`, which is what keeps the right-press delete off it. */
  const mergedEntries = useMemo<MergedEntry[]>(() => {
    const own: MergedEntry[] = entries.map((entry) => ({ ...entry, source: 'ledger' }))
    // A ledger buy on the same game and day supersedes that game's panel
    // purchase — an edit made here on the purchase's own date overwrites it
    // rather than standing beside it and doubling the figure.
    const shadowed = new Set(
      entries.filter((e) => e.kind === 'buy').map((e) => `${e.gameId ?? 'none'}:${e.date}`)
    )
    const purchases: MergedEntry[] = games
      .filter((game) => game.purchasePrice != null)
      .map((game) => ({
        id: null,
        gameId: game.id,
        kind: 'buy' as const,
        price: game.purchasePrice as number,
        date: game.purchaseDate ?? game.createdAt.slice(0, 10),
        source: 'purchase' as const
      }))
      .filter((entry) => !shadowed.has(`${entry.gameId ?? 'none'}:${entry.date}`))
    return [...own, ...purchases]
  }, [entries, games])

  const [from, to] = useMemo(
    () => periodRange(period, mergedEntries, custom),
    [period, mergedEntries, custom]
  )
  const fromIsoStr = isoDate(from)
  const toIsoStr = isoDate(to)

  /* The entries in the period, and of it the ones the ☑ pair counts. */
  const periodEntries = useMemo(
    () => mergedEntries.filter((entry) => entry.date >= fromIsoStr && entry.date <= toIsoStr),
    [mergedEntries, fromIsoStr, toIsoStr]
  )
  const counted = useMemo(
    () =>
      periodEntries.filter(
        (entry) => (entry.kind === 'buy' && includeBuy) || (entry.kind === 'sell' && includeSell)
      ),
    [periodEntries, includeBuy, includeSell]
  )

  /* The list and the pie are one row per game *and kind*: a game bought and
     sold in the period keeps a buy row and a sell row, in its own colour by
     rank. With only one kind on the two collapse to one row a game anyway. */
  const rows = useMemo(() => {
    const totals = new Map<string, { gameId: number | null; kind: LedgerKind; total: number }>()
    for (const entry of counted) {
      const key = `${entry.gameId ?? 'none'}:${entry.kind}`
      const cur = totals.get(key) ?? { gameId: entry.gameId, kind: entry.kind, total: 0 }
      cur.total += entry.price
      totals.set(key, cur)
    }
    return [...totals.values()]
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((row, index) => ({
        ...row,
        key: `${row.gameId ?? 'none'}:${row.kind}`,
        color: colorForRank(index)
      }))
  }, [counted])

  /* The magnitude the ring is cut by, and the headline in its middle. Both
     kinds on, the middle is what was spent net of what was sold; one kind on,
     it is that kind's own total. */
  const ringTotal = rows.reduce((sum, row) => sum + row.total, 0)
  const countedBuys = counted.filter((e) => e.kind === 'buy').reduce((s, e) => s + e.price, 0)
  const countedSells = counted.filter((e) => e.kind === 'sell').reduce((s, e) => s + e.price, 0)
  const centreTotal =
    includeBuy && includeSell
      ? countedBuys - countedSells
      : includeBuy
        ? countedBuys
        : includeSell
          ? countedSells
          : 0

  const totalSpent = useMemo(
    () => mergedEntries.filter((e) => e.kind === 'buy').reduce((s, e) => s + e.price, 0),
    [mergedEntries]
  )
  const totalSold = useMemo(
    () => mergedEntries.filter((e) => e.kind === 'sell').reduce((s, e) => s + e.price, 0),
    [mergedEntries]
  )
  const bothKinds = includeBuy && includeSell

  // Draw the ring's arrival again whenever what it shows changes.
  useEffect(() => {
    setReveal((n) => n + 1)
  }, [period, includeBuy, includeSell, ringTotal, rows.length])

  async function addEntry(): Promise<void> {
    const value = Number(price)
    if (formGameId === null) {
      setError(t('ゲームを選んでください'))
      return
    }
    if (!price.trim() || !Number.isFinite(value) || value < 0) {
      setError(t('金額を入力してください'))
      return
    }
    if (!date) {
      setError(t('日付を入力してください'))
      return
    }
    setEntries(
      await window.library.addLedgerEntry({ gameId: formGameId, kind, price: value, date })
    )
    // The form keeps the game, price and day it saved, so the row it wrote
    // stays shown rather than emptying out — clear is how it is reset.
    setError(null)
  }

  /* The latest of a game's entries of a kind — the one the form shows when
     the game is picked. It reads the merged list, so a purchase set through
     the Add Game panel counts as much as a row written here does. */
  function latestEntry(gameId: number, forKind: LedgerKind): MergedEntry | null {
    const mine = mergedEntries
      .filter((entry) => entry.gameId === gameId && entry.kind === forKind)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return mine[0] ?? null
  }

  /* Picking a game shows what it already has for the kind on the toggle:
     its price and date are filled from the latest such entry, or cleared to a
     blank price on today where it has none, so a previous game's figures are
     never left standing. */
  function fillFor(gameId: number, forKind: LedgerKind): void {
    const existing = latestEntry(gameId, forKind)
    if (existing) {
      setPrice(String(existing.price))
      setDate(existing.date)
    } else {
      setPrice('')
      setDate(isoDate(new Date()))
    }
    setError(null)
  }

  function selectGame(gameId: number): void {
    setFormGameId(gameId)
    fillFor(gameId, kind)
  }

  /* The BUY / SELL toggle also re-reads the selected game, since a game can
     have both a buy and a sell and each shows its own figures. */
  function selectKind(next: LedgerKind): void {
    setKind(next)
    if (formGameId !== null) fillFor(formGameId, next)
  }

  function clearForm(): void {
    setKind('buy')
    setFormGameId(null)
    setPrice('')
    setDate(isoDate(new Date()))
    setError(null)
  }

  /* A range set anywhere — the menu's own date rows or either of the two
     stamps — takes the period off the presets and onto that span, the way the
     PlayTime Graph's own `specify` does. */
  function specify(a: Date, b: Date): void {
    setCustom([isoDate(a), isoDate(b)])
    setPeriod('custom')
  }

  function openMenu(gameId: number | null, forKind: LedgerKind, event: React.MouseEvent): void {
    const board = (event.currentTarget as HTMLElement).closest('.ledger-board')
    if (!board) return
    event.preventDefault()
    // Nothing to delete on a row that is only a game's own purchase — the menu
    // has one item and it would do nothing, so it is not put up.
    if (!counted.some((e) => e.gameId === gameId && e.kind === forKind && e.source === 'ledger'))
      return
    menuOpener.current = event.currentTarget as HTMLElement
    const box = board.getBoundingClientRect()
    const scale = box.width / BOARD_WIDTH
    setMenu({
      gameId,
      kind: forKind,
      left: Math.min((event.clientX - box.left) / scale, BOARD_WIDTH - CONTEXT_MENU_WIDTH),
      top: Math.min((event.clientY - box.top) / scale, box.height / scale - CONTEXT_MENU_HEIGHT)
    })
  }

  /* The right press's own deletion: it takes off the entries the row stands
     for — the game's, of that one kind, in the period. **Only the book's own
     rows go**; a game's purchase from the Add Game panel is that game's field,
     not the ledger's to remove. */
  async function deleteRow(gameId: number | null, forKind: LedgerKind): Promise<void> {
    setDeleting(null)
    const doomed = counted.filter(
      (entry) =>
        entry.gameId === gameId &&
        entry.kind === forKind &&
        entry.source === 'ledger' &&
        entry.id != null
    )
    let list = entries
    for (const entry of doomed) list = await window.library.deleteLedgerEntry(entry.id as number)
    setEntries(list)
  }

  const priceLabel = kind === 'buy' ? 'Buy Price' : 'Sell Price'
  const dateLabel = kind === 'buy' ? 'Buy Date' : 'Sell Date'
  // The field shows a short "CUSTOM" for the specified range; the menu row is
  // the design's own "SPECIFY THE PERIOD".
  const periodLabel =
    period === 'custom' ? 'CUSTOM' : (PERIODS.find((p) => p.key === period)?.label ?? 'THIS WEEK')

  /* Places the cursor-following tooltip for whatever row (a wedge or a list
     row) the pointer is on, in the board's own design pixels — 16 off the
     pointer's lower right, flipped to the left or lifted up where it would
     run past the board's edges, the way the graph's Hover Pie Game is. */
  function trackHover(key: string, event: React.MouseEvent): void {
    const row = rows.find((one) => one.key === key)
    const box = boardRef.current?.getBoundingClientRect()
    if (!row || !box || box.width <= 0) return
    const scale = box.width / BOARD_WIDTH
    const px = (event.clientX - box.left) / scale
    const py = (event.clientY - box.top) / scale
    const boardH = box.height / scale
    const PANEL_W = 340
    const PANEL_H = 118
    let x = px + 16
    if (x + PANEL_W > BOARD_WIDTH) x = px - 16 - PANEL_W
    let y = py + 16
    if (y + PANEL_H > boardH) y = Math.max(0, boardH - PANEL_H)
    setHoverInfo({
      name: gameName(row.gameId),
      amount: formatMoney(row.total, language),
      kind: row.kind,
      color: row.color,
      x,
      y
    })
  }

  return (
    <section className={`ledger-board${clipping ? ' is-arriving' : ''}`} ref={boardRef}>
      {/* Penpot: the two plates set into the header's and the footer's rules.
          The label is held left and the value right, with air either side, so
          the colon and the figure balance across the plate. */}
      <div className="ledger-plate top">
        <span className="ledger-plate-label">TOTAL SPENT (ENTIRE PERIOD) :</span>
        <span className="ledger-plate-value">{formatMoney(totalSpent, language)}</span>
      </div>
      <div className="ledger-plate bottom">
        <span className="ledger-plate-label">TOTAL SELL (ENTIRE PERIOD) :</span>
        <span className="ledger-plate-value">{formatMoney(totalSold, language)}</span>
      </div>

      {/* Penpot: Left — the Period at the top and the Buy / Sell Box below. */}
      <div className="ledger-left">
        {/* Penpot: Period — 459x101 at 30/30: Start Day » Start Day. It
            arrives the way the graph's does — each block sliding in and
            pitching over on its own corner. */}
        <div className="ledger-period">
          <DayStamp className="from" day={from} onChange={(next) => specify(next, to)} />
          <span className="ledger-arrow">»</span>
          <DayStamp className="to" day={to} onChange={(next) => specify(from, next)} />
        </div>
        <div className="ledger-underline">
          <span className="ledger-underline-bar" />
          <span className="ledger-underline-taper" />
        </div>
        {/* Penpot: Period Setting — 291x39, the label and the ▼. It drops the
            graph's own Setting Period board (`period-menu`): the presets
            left-aligned, and a SPECIFY THE PERIOD block with the two date rows
            the graph uses. */}
        <div className="ledger-period-setting" ref={periodRef}>
          <button
            type="button"
            className="ledger-period-field"
            onClick={() => setPeriodMenu((open) => !open)}
          >
            {periodLabel}
          </button>
          <button
            type="button"
            className="ledger-period-caret"
            onClick={() => setPeriodMenu((open) => !open)}
            aria-expanded={periodMenu}
          >
            ▼
          </button>
          {periodMenu && (
            <LedgerPeriodMenu
              period={period}
              from={from}
              to={to}
              anchorRef={periodRef}
              onPick={(key) => {
                setPeriod(key)
                setPeriodMenu(false)
              }}
              onSpecify={specify}
              onDismiss={() => setPeriodMenu(false)}
            />
          )}
        </div>

        {/* Penpot: Buy / Sell Box — the form that adds an entry */}
        <div className="ledger-box">
          <div className="ledger-rule r1" />
          <div className="ledger-toggle">
            <button
              type="button"
              className={`ledger-toggle-half${kind === 'buy' ? ' on' : ''}`}
              onClick={() => selectKind('buy')}
            >
              BUY
            </button>
            <span className="ledger-toggle-rule" />
            <button
              type="button"
              className={`ledger-toggle-half${kind === 'sell' ? ' on' : ''}`}
              onClick={() => selectKind('sell')}
            >
              SELL
            </button>
          </div>
          <div className="ledger-rule r2" />

          {/* The game the entry is about, picked from the library. */}
          <div className="ledger-row game">
            <span className="ledger-label">Game</span>
            <div className="ledger-select" ref={gameRef}>
              <button
                type="button"
                className={`ledger-select-value${formGameId === null ? ' empty' : ''}`}
                onClick={() => setGameMenu((open) => !open)}
              >
                {formGameId === null ? '---' : gameName(formGameId)}
              </button>
              <span className="ledger-select-divider" />
              <button
                type="button"
                className="ledger-select-caret"
                onClick={() => setGameMenu((open) => !open)}
                aria-expanded={gameMenu}
              >
                ▼
              </button>
              {gameMenu && games.length > 0 && (
                <OptionMenu
                  options={games.map((game) => ({
                    key: String(game.id),
                    label: displayName(game),
                    // The game's own icon, before its name — an empty square
                    // where a game has none, so the names still line up.
                    iconUrl: game.iconPath ? mediaUrl(game.iconPath) : '',
                    current: game.id === formGameId
                  }))}
                  top={39 + 6}
                  left={0}
                  width={291}
                  maxRows={8}
                  ellipsize
                  onPick={(key) => {
                    selectGame(Number(key))
                    setGameMenu(false)
                  }}
                  onDismiss={() => setGameMenu(false)}
                  anchorRef={gameRef}
                />
              )}
            </div>
          </div>
          <div className="ledger-rule r3" />

          {/* Penpot: the price and the date fields, their labels following the
              BUY / SELL toggle. The price carries the currency mark. */}
          <div className="ledger-row price">
            <span className="ledger-label">{priceLabel}</span>
            <div className="ledger-price-box">
              <span className="ledger-currency">{language === 'en' ? '$' : '¥'}</span>
              <input
                className="ledger-price-input"
                type="number"
                min="0"
                step="1"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="Price..."
              />
            </div>
          </div>
          <div className="ledger-rule r4" />

          <div className="ledger-row date">
            <span className="ledger-label">{dateLabel}</span>
            <input
              className="ledger-input ledger-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="ledger-rule r5" />

          <div className="ledger-actions">
            <button type="button" className="ledger-clear" onClick={clearForm}>
              clear
            </button>
            <button type="button" className="ledger-ok" onClick={() => void addEntry()}>
              ok
            </button>
          </div>
        </div>
      </div>

      {/* Penpot: Middle — the Pie Chart with the total across it. */}
      <div className="ledger-middle">
        <div className={`ledger-pie${ringTotal > 0 ? ' charted' : ''}`}>
          <PieChart
            slices={rows.map((row) => ({
              key: row.key,
              color: row.color,
              share: ringTotal > 0 ? row.total / ringTotal : 0
            }))}
            size={PIE_SIZE}
            reveal={reveal}
            highlight={hovered}
            onSliceHover={(key, event) => {
              setHovered(key)
              trackHover(key, event)
            }}
            onSliceLeave={() => {
              setHovered(null)
              setHoverInfo(null)
            }}
          />
          <div className="ledger-pie-label">
            <span className="title">TOTAL PRICE</span>
            {/* A negative net (sold more than bought) is written with a "+"
                at the head rather than a minus — the minus turned into a plus,
                the magnitude kept. */}
            <span className="total">
              {centreTotal < 0
                ? `+${formatMoney(-centreTotal, language)}`
                : formatMoney(centreTotal, language)}
            </span>
          </div>
        </div>
        {/* Penpot: On / Off Buy / Sell — the two kinds' switches. BUY slides
            in from a little to the left and SELL from the right. */}
        <div className="ledger-onoff">
          <button
            type="button"
            className="ledger-onoff-run buy"
            onClick={() => setIncludeBuy((on) => !on)}
          >
            {includeBuy ? '☑' : '☐'} BUY
          </button>
          <button
            type="button"
            className="ledger-onoff-run sell"
            onClick={() => setIncludeSell((on) => !on)}
          >
            {includeSell ? '☑' : '☐'} SELL
          </button>
        </div>
      </div>

      {/* Penpot: Right — the Game List between its two rules. */}
      <div className="ledger-right">
        <div className="ledger-right-rule top" />
        <div className="ledger-game-list">
          {rows.length === 0 ? (
            <div className="ledger-empty">no entry</div>
          ) : (
            rows.map((row, index) => (
              <div
                className={`ledger-game${hovered && hovered !== row.key ? ' dimmed' : ''}`}
                key={row.key}
                style={{
                  animationDelay: `${ARRIVAL_MS + Math.min(index * LEGEND_STEP_MS, LEGEND_STEP_MAX_MS)}ms`
                }}
                onMouseEnter={(event) => {
                  setHovered(row.key)
                  trackHover(row.key, event)
                }}
                onMouseMove={(event) => trackHover(row.key, event)}
                onMouseLeave={() => {
                  setHovered(null)
                  setHoverInfo(null)
                }}
                onContextMenu={(event) => openMenu(row.gameId, row.kind, event)}
              >
                <div className="ledger-game-head">
                  {/* The rank colour shows as a frame around the game's own
                      icon; a game with no icon keeps the solid colour square. */}
                  <span className="ledger-game-color" style={{ background: row.color }}>
                    {gameIcon(row.gameId) && (
                      <img src={gameIcon(row.gameId) as string} alt="" draggable={false} />
                    )}
                  </span>
                  <span className="ledger-game-name">{gameName(row.gameId)}</span>
                </div>
                {/* With both kinds shown a buy is blue and a sell red, so a
                    game's two frames are told apart; with one kind on the
                    figure keeps the app's text. */}
                <div
                  className={`ledger-game-amount${
                    bothKinds ? (row.kind === 'buy' ? ' buy' : ' sell') : ''
                  }`}
                >
                  {formatMoney(row.total, language)}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="ledger-right-rule bottom" />
      </div>

      {menu && (
        <ContextMenu
          style={{ left: `${menu.left}px`, top: `${menu.top}px` }}
          items={[
            {
              label: t('削除'),
              danger: true,
              onSelect: () => {
                setDeleting({ gameId: menu.gameId, kind: menu.kind, name: gameName(menu.gameId) })
                setMenu(null)
              }
            }
          ]}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="delete entries"
          message={
            deleting.kind === 'buy'
              ? t('「{0}」のこの期間の購入記録を削除しますか？', deleting.name)
              : t('「{0}」のこの期間の売却記録を削除しますか？', deleting.name)
          }
          onCancel={() => setDeleting(null)}
          onConfirm={() => void deleteRow(deleting.gameId, deleting.kind)}
        />
      )}

      {/* The cursor-following tooltip — the game's name over the amount, the
          amount blue for a buy and red for a sell, the way the PlayTime
          Graph's own hover panel follows the pointer. */}
      {hoverInfo && (
        <div className="ledger-hover" style={{ left: `${hoverInfo.x}px`, top: `${hoverInfo.y}px` }}>
          <span className="ledger-hover-name" style={{ color: hoverInfo.color }}>
            {hoverInfo.name}
          </span>
          <span className={`ledger-hover-amount ${hoverInfo.kind}`}>{hoverInfo.amount}</span>
        </div>
      )}

      {error !== null && (
        <ConfirmDialog title={t('帳簿')} message={error} onConfirm={() => setError(null)} />
      )}
    </section>
  )
}

/**
 * The board the Period Setting drops — the PlayTime Graph's own Setting Period
 * board (`period-menu` styling), with the seven presets left-aligned over a
 * rule and the SPECIFY THE PERIOD block whose two date rows are the graph's
 * own `DateRow`. There is no SET DEFAULT: the ledger keeps no default period.
 */
function LedgerPeriodMenu({
  period,
  from,
  to,
  anchorRef,
  onPick,
  onSpecify,
  onDismiss
}: {
  period: Period
  from: Date
  to: Date
  anchorRef: React.RefObject<HTMLElement>
  onPick: (key: Period) => void
  onSpecify: (from: Date, to: Date) => void
  onDismiss: () => void
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  // Drawn out by default, the way the graph's own block is.
  const [specifying, setSpecifying] = useState(true)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onDismiss()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onDismiss, anchorRef])

  return (
    <div className="period-menu" ref={rootRef} role="menu" style={{ top: 45, left: 0 }}>
      <div className="period-menu-options">
        {PERIODS.filter((p) => p.key !== 'custom').map((row) => (
          <div
            key={row.key}
            className={`period-menu-row${period === row.key ? ' is-current' : ''}`}
          >
            <button
              type="button"
              className="period-menu-label"
              role="menuitem"
              onClick={() => onPick(row.key)}
            >
              {row.label}
            </button>
          </div>
        ))}
      </div>

      <div className="period-menu-rule" />

      <div className={`period-menu-specify${specifying ? '' : ' is-folded'}`}>
        <div className="period-menu-specify-head">
          <span className="period-menu-specify-title">SPECIFY THE PERIOD</span>
          <button
            type="button"
            className="period-menu-specify-caret"
            onClick={() => setSpecifying((was) => !was)}
          >
            {specifying ? '▼' : '▲'}
          </button>
        </div>
        {specifying && (
          <div className="period-menu-dates">
            <DateRow value={from} onChange={(next) => onSpecify(next, to)} />
            <span className="period-menu-to">»</span>
            <DateRow value={to} onChange={(next) => onSpecify(from, next)} />
          </div>
        )}
      </div>
    </div>
  )
}

/* Penpot: Start Day — the month over the year, the day dropped below the great
   slash and the weekday small beside it. Three of the four are typed over in
   place, the same as the PlayTime Graph's own stamp: the design draws a stamp
   that only reads, but it is the one thing on the board that says what the
   period is, so it is also where one is set. The weekday is not among them — it
   follows from the other three. */
type DayPartName = 'month' | 'date' | 'year'

function DayStamp({
  className,
  day,
  onChange
}: {
  className: string
  day: Date
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
    <div className={`ledger-day ${className}`}>
      <DayPart
        className="ledger-day-month"
        text={pad2(day.getMonth() + 1)}
        active={editing === 'month'}
        onOpen={() => setEditing('month')}
        onClose={() => setEditing(null)}
        onCommit={(text) => commit('month', text)}
      />
      <svg className="ledger-day-slash" viewBox="0 0 151 101" aria-hidden="true">
        <line x1="60" y1="83.3" x2="101" y2="5.7" />
      </svg>
      <DayPart
        className="ledger-day-date"
        text={pad2(day.getDate())}
        active={editing === 'date'}
        onOpen={() => setEditing('date')}
        onClose={() => setEditing(null)}
        onCommit={(text) => commit('date', text)}
      />
      <DayPart
        className="ledger-day-year"
        text={String(day.getFullYear())}
        active={editing === 'year'}
        onOpen={() => setEditing('year')}
        onClose={() => setEditing(null)}
        onCommit={(text) => commit('year', text)}
      />
      <span className="ledger-day-weekday">{WEEKDAYS[day.getDay()]}</span>
    </div>
  )
}

/* One of a stamp's three figures: the run as drawn until it is clicked, and the
   same run as a field after that. Settled on blur or Enter. Escape flags the
   cancel rather than writing the old text back into the field — the blur that
   follows commits what the field was *rendered* with. */
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
      <button
        type="button"
        className={`${className} ledger-day-run`}
        onClick={onOpen}
        title={t('編集')}
      >
        {text}
      </button>
    )
  }
  return (
    <input
      className={`${className} ledger-day-input`}
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
