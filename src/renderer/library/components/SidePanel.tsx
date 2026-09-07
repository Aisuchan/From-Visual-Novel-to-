import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameWithStats, Group, Tag } from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import { useContextMenuDismiss } from '../context-menu'
import { formatClock } from '../format'
import ContextMenu from './ContextMenu'
import OptionMenu from './OptionMenu'
import { filterGames, suggestsGroup } from '../filter'
import TagChip from './TagChip'
import {
  DEFAULT_DIRECTION,
  DEFAULT_SORT,
  directionLabel,
  displayName,
  hasDirection,
  MANUAL_SORT,
  parseSortOption,
  sortGames,
  sortLabel,
  SORT_OPTIONS,
  sortOptionLabel,
  sortOptionId,
  type SortDirection,
  type SortKey
} from '../sort'
import './SidePanel.css'
import { t } from '../../../shared/i18n'

interface Props {
  games: GameWithStats[]
  /** The groups the Select Group menu offers. */
  groups: Group[]
  /** The tag vocabulary the filter chips are matched against. */
  tags: Tag[]
  selectedGameId: number | null
  onSelect: (gameId: number) => void
  onReorder: (orderedIds: number[]) => void
  onEditGame: (game: GameWithStats) => void
  /** Asks to delete it; the shell is what puts the confirmation up. */
  onDeleteGame: (gameId: number) => void
  /** The menu's top row: puts Penpot's New Group Setting up. */
  onAddGroup: () => void
  /** The HOME button: puts Penpot's Home board in the content column. It is
      not called while that board is already up — the plate is where you are,
      not somewhere to go. */
  onHome: () => void
  /** Whether that board is the one up, which the button stays lit for. */
  homeOpen: boolean
  /** The clock: puts Penpot's Calender board in the content column, and takes
      it away again — the same toggle HOME and the footer's ⚙ make. */
  onCalendar: () => void
  /** Whether that board is the one up, which the clock stays lit for. */
  calendarOpen: boolean
}

interface ContextMenu {
  game: GameWithStats
  x: number
  y: number
}

/* Penpot: Side Panel 335 wide, Game LIst 5px top padding, Game Column 60 tall. */
const SIDE_PANEL_WIDTH = 335
const GAME_LIST_PADDING_TOP = 5
const GAME_COLUMN_HEIGHT = 60

/* The design's rows are all 55 tall, so a menu's top is the rows above it: the
   Search Box row, then the Select Group row the Sort row follows. */
const GROUP_MENU_TOP = 110
const SORT_MENU_TOP = 165
/** The groups that stand before the list scrolls. The design draws five; eight
    is what was asked for, and the row that adds one stands over them. */
const GROUP_MENU_ROWS = 8
/* The Sort menu's own count. Every order but 50音順 is offered twice, which
   makes fifteen rows, and the panel has no room for them: the menu drops at 165
   of a container that itself begins 390 down, so ten rows (405 with its
   paddings) end at 960 and leave the shortest window the shell is laid out for
   its own room underneath. Past that it scrolls, and the rules down the left
   say so — and the list opens brought to the row it stands on. */
const SORT_MENU_ROWS = 10
/** The key the add row answers to, which is no group's id. */
const ADD_GROUP_KEY = 'add-group'

/**
 * The colour a game's frame takes: its group's own, or nothing at all.
 *
 * A game carries its group by *name* (`games.group_name` is free text and
 * always was), so the list is what turns that into a colour — and a name no
 * group answers to, which is what a name typed before the group existed is,
 * comes back transparent rather than picking one.
 */
function groupInk(name: string | null | undefined, groups: Group[]): string {
  const term = (name ?? '').trim().toLowerCase()
  if (!term) return 'transparent'
  const found = groups.find((group) => group.name.trim().toLowerCase() === term)
  return found ? found.color : 'transparent'
}

export default function SidePanel({
  games,
  groups,
  tags,
  selectedGameId,
  onSelect,
  onReorder,
  onEditGame,
  onDeleteGame,
  onAddGroup,
  onHome,
  homeOpen,
  onCalendar,
  calendarOpen
}: Props): React.JSX.Element {
  const [now, setNow] = useState(new Date())
  /** What is typed in the box, and the term actually applied to the list. */
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOrder, setDragOrder] = useState<number[] | null>(null)
  const [searchOptionsOpen, setSearchOptionsOpen] = useState(false)
  // Kept mounted through the closing fold, which is the opening one run backwards.
  const [searchOptionsClosing, setSearchOptionsClosing] = useState(false)
  /* What is in the Select Group field, and the group the list is actually
     narrowed to. They are two things: the filter only moves when the field is
     settled — a row picked out of the menu, Enter, or the caret leaving it —
     so a name is not typed through a run of lists nobody asked for. A field
     emptied out is settled as it happens; see the same pair on the Home
     board. */
  const [groupQuery, setGroupQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  /* Which of Penpot's "Menu" boards is out, at most one at a time. The Select
     Group button drops the whole list out of its row; typing in that field puts
     the same board up as the field's own suggestions, which is the list
     narrowed to what has been typed and without the row that adds to it. */
  const [openMenu, setOpenMenu] = useState<'none' | 'group' | 'group-suggest' | 'sort'>('none')
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT)
  const [sortDir, setSortDir] = useState<SortDirection>(DEFAULT_DIRECTION[DEFAULT_SORT])
  /* The chips Add Tag puts out. They are a filter over the list and nothing
     more: a chip is a piece of text, the row belongs to this panel alone, and
     taking one off narrows nothing further — it never touches a tag on a game.
     `newTagId` is the chip that has just appeared, which takes the caret. */
  const [tagFilters, setTagFilters] = useState<{ id: number; text: string }[]>([])
  const [newTagId, setNewTagId] = useState<number | null>(null)
  const nextTagFilterId = useRef(1)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const dateRef = useRef<HTMLSpanElement | null>(null)
  const groupRowRef = useRef<HTMLDivElement | null>(null)
  const sortRowRef = useRef<HTMLDivElement | null>(null)
  const sortFieldRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const { dateLabel, timeLabel } = formatClock(now)

  // Penpot draws the date at 60px for "2026 8/1 (Sat.)". Longer dates would
  // overrun the 311px clock, so step down just far enough to fit.
  useEffect(() => {
    const el = dateRef.current
    if (!el) return
    el.style.fontSize = '60px'
    const available = 299
    const width = el.scrollWidth
    if (width > available) el.style.fontSize = `${Math.floor(60 * (available / width))}px`
  }, [dateLabel])

  /* Penpot draws Way of Sort 144 wide, which is the room "Sort..." needs. The
     orders it names are sentences, so the label steps down just far enough to
     fit, the way the date above it does. The field is only there while the
     search options are out, so its mounting is one of the triggers.

     **The padding comes out of both figures before they are compared.** A
     field's `scrollWidth` and `clientWidth` both carry it, and it does not
     scale with the type, so scaling by their bare ratio undershoots by however
     much padding there is — measured with the direction mark's 24 added on the
     right, 「プレイ時間順」 came out at 19px and still ran 6px past the box. */
  useEffect(() => {
    const el = sortFieldRef.current
    if (!el) return
    el.style.fontSize = '24px'
    const style = getComputedStyle(el)
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const available = el.clientWidth - padding
    const run = el.scrollWidth - padding
    if (run > available && available > 0) {
      el.style.fontSize = `${Math.floor(24 * (available / run))}px`
    }
  }, [sortKey, searchOptionsOpen])

  function addTag(): void {
    const id = nextTagFilterId.current++
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

  /** Takes the chip off the row. The tag itself is the games' and stays. */
  function deleteTag(id: number): void {
    setNewTagId((current) => (current === id ? null : current))
    setTagFilters((list) => list.filter((chip) => chip.id !== id))
  }

  // Any click, a second right-click, or Escape dismisses the context menu.
  const menuOpener = useContextMenuDismiss(menu !== null, () => setMenu(null))

  /* Every chip on the row is a condition, so a game has to answer to all of
     them to stay in the list; a chip still being written is not a condition
     yet. The rule itself is shared with the Home board, which draws the same
     three controls over the same library (`filter.ts`). */
  const filtered = useMemo(
    () =>
      filterGames(games, tags, {
        query,
        group: groupFilter,
        tagTerms: tagFilters.map((chip) => chip.text)
      }),
    [games, query, groupFilter, tagFilters, tags]
  )

  /* What the Sort field asks for. "手動並び順" is the list's own stored order —
     `sort_order`, which starts as the order the games were registered in and is
     only ever changed by the drag handle — so it is the one face of the list
     that can be dragged; every other one is a view over it, and the handle is
     not drawn at all under those. */
  const ordered = useMemo(
    () => sortGames(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir]
  )
  const canReorder = sortKey === MANUAL_SORT
  /* Which of the menu's rows the list stands on, which is the pair rather than
     the order alone. */
  const currentSortId = sortOptionId(sortKey, sortDir)
  /* The field is 144 for a label of six Japanese characters, so what it writes
     is the order's name and nothing else; the direction is said here, where a
     word costs no room. */
  // While dragging, the list renders `dragOrder` so rows swap under the cursor;
  // the real reorder is only committed on release.
  const rows = useMemo(() => {
    if (!dragOrder) return ordered
    const byId = new Map(ordered.map((g) => [g.id, g]))
    return dragOrder.map((id) => byId.get(id)).filter((g): g is GameWithStats => !!g)
  }, [ordered, dragOrder])

  /** Row index under the pointer, in the list's own design-pixel space. */
  function rowIndexAt(clientY: number, count: number): number {
    const list = listRef.current
    if (!list) return 0
    const rect = list.getBoundingClientRect()
    const scale = rect.width / SIDE_PANEL_WIDTH
    const y = (clientY - rect.top) / scale - GAME_LIST_PADDING_TOP + list.scrollTop
    return Math.max(0, Math.min(count - 1, Math.floor(y / GAME_COLUMN_HEIGHT)))
  }

  function startDrag(e: React.PointerEvent<HTMLElement>, gameId: number): void {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragId(gameId)
    setDragOrder(ordered.map((g) => g.id))
  }

  function moveDrag(e: React.PointerEvent<HTMLElement>): void {
    if (dragId === null || !dragOrder) return
    const from = dragOrder.indexOf(dragId)
    const to = rowIndexAt(e.clientY, dragOrder.length)
    if (from < 0 || to === from) return
    const next = [...dragOrder]
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    setDragOrder(next)
  }

  function endDrag(): void {
    if (dragId !== null && dragOrder) {
      const before = ordered.map((g) => g.id)
      if (dragOrder.some((id, i) => id !== before[i])) {
        // A search may be narrowing the list, so only the slots the filtered
        // games occupy are rewritten; everything else keeps its position.
        const moved = new Set(dragOrder)
        /* Under 降順 the rows are the stored order turned round, so what is
           written back has to be turned round again: `games` is in the stored
           order and the queue fills the slots it left in that same order. */
        const queue = sortDir === 'desc' ? [...dragOrder].reverse() : [...dragOrder]
        onReorder(games.map((g) => (moved.has(g.id) ? (queue.shift() as number) : g.id)))
      }
    }
    setDragId(null)
    setDragOrder(null)
  }

  /* The group menu's rows: the groups, each in its own colour, under the row
     that adds one — which belongs to the whole list rather than to a search, so
     the suggestions leave it off and narrow the list to what has been typed.

     This is the only thing that decides whether the board is up: no rows, no
     menu. Reading `openMenu` here rather than at the render is what keeps a
     closed menu closed — the list is not empty just because nothing opened it,
     and a condition that only looked at the rows put it back on screen. */
  const groupOptions = useMemo(() => {
    if (openMenu !== 'group' && openMenu !== 'group-suggest') return []
    const rows = groups
      .filter((group) => openMenu === 'group' || suggestsGroup(group.name, groupQuery))
      .map((group) => ({ key: String(group.id), label: group.name, color: group.color }))
    return openMenu === 'group'
      ? [{ key: ADD_GROUP_KEY, label: t('グループを追加 ＋') }, ...rows]
      : rows
  }, [groups, openMenu, groupQuery])

  const searchOptionsExpanded = searchOptionsOpen && !searchOptionsClosing

  /** Folds the two select rows out and back, one open at a time. */
  function toggleSearchOptions(): void {
    if (!searchOptionsOpen) {
      setSearchOptionsClosing(false)
      setSearchOptionsOpen(true)
    } else if (searchOptionsClosing) {
      // Clicking again mid-close takes it straight back to open.
      setSearchOptionsClosing(false)
    } else {
      // The menus hang off the rows that are folding away, so they go too.
      setOpenMenu('none')
      setSearchOptionsClosing(true)
    }
  }

  /** Cursor position in the panel's design-pixel space (cancels the shell zoom). */
  function designPointWithin(clientX: number, clientY: number): { x: number; y: number } {
    const panel = panelRef.current
    if (!panel) return { x: 0, y: 0 }
    const rect = panel.getBoundingClientRect()
    const scale = rect.width / 335
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
  }

  return (
    <aside className="side-panel" ref={panelRef}>
      {/* Not in the design: the clock is a button — it puts Penpot's Calender
          board in the content column — and stays lit while that board is up,
          the way the HOME plate below it does for Home. */}
      <button
        className={`clock${calendarOpen ? ' is-open' : ''}`}
        onClick={onCalendar}
        title={calendarOpen ? t('カレンダーを閉じる') : t('カレンダーを開く')}
        aria-pressed={calendarOpen}
      >
        <span className="clock-date" ref={dateRef}>
          {dateLabel}
        </span>
        <span className="clock-time">{timeLabel}</span>
      </button>

      <button
        className={`home-button${homeOpen ? ' is-open' : ''}`}
        onClick={() => {
          if (!homeOpen) onHome()
        }}
        title={homeOpen ? undefined : t('ライブラリを一覧する')}
        aria-pressed={homeOpen}
      >
        <span className="home-button-diamond">♦</span>
        <span className="home-button-word">&nbsp;home&nbsp;</span>
        <span className="home-button-diamond">♦</span>
      </button>

      <div className="search-option-container">
        <div className="search-box">
          {/* Typing only edits the field; the list is filtered when the search
              is submitted with the button or Enter. */}
          <input
            className="search-input"
            placeholder="Search..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setQuery(searchInput.trim())
            }}
          />
          <button
            className="search-submit"
            onClick={() => setQuery(searchInput.trim())}
            title={t('検索')}
            aria-label={t('検索')}
          >
            <i className="fa-brands fa-sistrix" />
          </button>
        </div>

        {/* Penpot: Select Group / Select Tag and Choose Way To Sort — hidden in
            the design until the search options are stretched open. Group, tag
            and sort management are deferred, so these are inert placeholders. */}
        {searchOptionsOpen && (
          <div
            className={`search-options ${searchOptionsClosing ? 'closing' : ''}`}
            onAnimationEnd={(e) => {
              if (e.target !== e.currentTarget) return
              if (searchOptionsClosing) {
                setSearchOptionsOpen(false)
                setSearchOptionsClosing(false)
              }
            }}
          >
            <div className="search-options-inner">
              <div className="select-row" ref={groupRowRef}>
                {/* Not in the design: the field carries its own ✕, so a group can
                    be let go of without deleting the name a character at a time. */}
                <div className="select-field-box">
                  <input
                    className="select-field"
                    placeholder="Select Group..."
                    value={groupQuery}
                    onChange={(e) => {
                      /* A blank is nothing typed; see the same field on the
                         Home board. Only an all-whitespace run goes. */
                      const text = e.target.value.trim() ? e.target.value : ''
                      setGroupQuery(text)
                      if (!text) setGroupFilter('')
                      setOpenMenu(text ? 'group-suggest' : 'none')
                    }}
                    onKeyDown={(e) => {
                      /* Enter settles the field — but not the Enter that ends
                         an IME conversion, which is choosing a character. */
                      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                      setGroupFilter(groupQuery)
                      setOpenMenu('none')
                    }}
                    onFocus={() => {
                      if (groupQuery.trim()) setOpenMenu('group-suggest')
                    }}
                    onBlur={() => {
                      setGroupFilter(groupQuery)
                      setOpenMenu((menu) => (menu === 'group-suggest' ? 'none' : menu))
                    }}
                  />
                  {groupQuery && (
                    <button
                      className="select-clear"
                      onClick={() => {
                        setGroupQuery('')
                        setGroupFilter('')
                        setOpenMenu('none')
                      }}
                      title={t('グループの絞り込みを解除')}
                      aria-label={t('グループの絞り込みを解除')}
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  )}
                </div>
                {/* Penpot: Show List of Group — drops the Menu below the row. */}
                <button
                  className="select-caret"
                  onClick={() => setOpenMenu((menu) => (menu === 'group' ? 'none' : 'group'))}
                  title={t('グループ一覧')}
                  aria-label={t('グループ一覧')}
                  aria-expanded={openMenu.startsWith('group')}
                >
                  ▼
                </button>
              </div>

              <div className="select-row" ref={sortRowRef}>
                {/* The order is one of a fixed list, so the field says which one
                    is on rather than taking anything typed; the menu is the only
                    way to change it, and the field is the other half of it. */}
                <input
                  className="select-field sort"
                  ref={sortFieldRef}
                  value={sortLabel(sortKey)}
                  readOnly
                  onClick={() => setOpenMenu((menu) => (menu === 'sort' ? 'none' : 'sort'))}
                />
                {/* Penpot: Show Way of Sort — drops the Menu below the row.
                    The direction is one of that menu's own rows rather than a
                    mark out here: the row comes to 333 of the panel's 335 and
                    has nothing left to give a second control. */}
                <button
                  className="select-caret sort"
                  onClick={() => setOpenMenu((menu) => (menu === 'sort' ? 'none' : 'sort'))}
                  title={t('並び順一覧')}
                  aria-label={t('並び順一覧')}
                  aria-expanded={openMenu === 'sort'}
                >
                  ▼
                </button>
                {/* Penpot: Add Tag — 111x40. What it puts out is the row of
                    chips below, which the design does not draw. */}
                <button className="add-tag" onClick={addTag}>
                  Add Tag
                </button>
              </div>

              {/* Not in the design: the chips themselves, in the space under
                  the Sort row. A chip is written as it is made and stands after
                  that; its own ✕ is what takes it off the row, and one left
                  empty goes by itself. */}
              {tagFilters.length > 0 && (
                <div className="tag-row">
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
              )}
            </div>
          </div>
        )}

        {/* Penpot: Menu — the groups, under the row the button that opened it
            is in. It is a sibling of the folding block rather than a child:
            that block clips its own children while it folds. */}
        {searchOptionsExpanded && groupOptions.length > 0 && (
          <OptionMenu
            options={groupOptions}
            top={GROUP_MENU_TOP}
            /* The groups are what the count is of; the row that adds one stands
               over them and is not one of them, and the suggestions leave it
               off entirely. */
            maxRows={GROUP_MENU_ROWS + (groupOptions[0]?.key === ADD_GROUP_KEY ? 1 : 0)}
            onPick={(key) => {
              setOpenMenu('none')
              if (key === ADD_GROUP_KEY) {
                onAddGroup()
                return
              }
              const picked = groups.find((group) => String(group.id) === key)
              if (picked) {
                setGroupQuery(picked.name)
                setGroupFilter(picked.name)
              }
            }}
            onDismiss={() => setOpenMenu('none')}
            anchorRef={groupRowRef}
          />
        )}

        {/* The Sort menu is the same board, dropped out of the row below.
            **Every order that can be turned round stands in it twice** — the
            way its own name reads, and the same order the other way under it,
            with the direction marked after the name — so the order and the way
            it runs are picked in the one act. The row it stands on takes the
            accent, and the list is opened brought to that row. */}
        {searchOptionsExpanded && openMenu === 'sort' && (
          <OptionMenu
            options={SORT_OPTIONS.map((sort) => ({
              key: sort.id,
              label: sortOptionLabel(sort),
              current: sort.id === currentSortId
            }))}
            top={SORT_MENU_TOP}
            maxRows={SORT_MENU_ROWS}
            scrollToKey={currentSortId}
            onPick={(id) => {
              const picked = parseSortOption(id)
              setSortKey(picked.key)
              setSortDir(picked.direction)
              setOpenMenu('none')
            }}
            onDismiss={() => setOpenMenu('none')}
            anchorRef={sortRowRef}
          />
        )}

        {/* Penpot: Strech / Shrink Search Option — the same 305x15 bar in both
            states, its caret turning over as the options fold out and back. */}
        <button
          className="search-strech"
          onClick={toggleSearchOptions}
          aria-expanded={searchOptionsExpanded}
        >
          {/* One glyph turned over on the fold's own clock, rather than two
              swapped at the moment of the click. */}
          <span className={`search-strech-glyph ${searchOptionsExpanded ? 'flipped' : ''}`}>▼</span>
        </button>
      </div>

      <ul className="game-list" ref={listRef}>
        {rows.map((game) => (
          <li key={game.id} className={`game-column ${game.id === dragId ? 'dragging' : ''}`}>
            <div
              className={`contents ${game.id === selectedGameId ? 'active' : ''}`}
              onClick={() => onSelect(game.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                // The row is what a second right-click on it toggles off.
                menuOpener.current = e.currentTarget
                const { x, y } = designPointWithin(e.clientX, e.clientY)
                setMenu({ game, x, y })
              }}
            >
              {/* The frame is the game's own group, in the colour that group
                  is written in wherever it is listed. A game filed under
                  nothing has no frame at all — the row says what it can, and
                  a colour standing for no group would be a colour meaning
                  nothing. */}
              <span
                className={`game-icon ${game.iconPath ? '' : 'empty'}`}
                style={{ borderColor: groupInk(game.groupName, groups) }}
              >
                {game.iconPath ? <img src={mediaUrl(game.iconPath)} alt="" /> : null}
              </span>
              {/* The short name stands in only when the game opts into it. */}
              <span className="game-name">{displayName(game)}</span>
              {/* Reordering starts here and nowhere else: press the handle and
                  drag, and the rows swap under the pointer as you move. What it
                  writes is the stored order, so it is only on the row while
                  that is the order on show. */}
              {canReorder && (
                <span
                  className="drag-handle"
                  title={t('ドラッグして並び替え')}
                  onPointerDown={(e) => startDrag(e, game.id)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={(e) => e.stopPropagation()}
                >
                  ⋮⋮
                </span>
              )}
            </div>
            <div className="game-column-border" />
          </li>
        ))}
      </ul>

      {menu && (
        <ContextMenu
          style={{ left: menu.x, top: menu.y }}
          items={[
            {
              label: t('情報の変更'),
              onSelect: () => {
                onEditGame(menu.game)
                setMenu(null)
              }
            },
            {
              label: t('削除'),
              danger: true,
              onSelect: () => {
                onDeleteGame(menu.game.id)
                setMenu(null)
              }
            }
          ]}
        />
      )}
    </aside>
  )
}
