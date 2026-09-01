import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameWithStats, Group, Tag } from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import { formatClock } from '../format'
import ContextMenu from './ContextMenu'
import OptionMenu from './OptionMenu'
import TagChip from './TagChip'
import {
  DEFAULT_SORT,
  displayName,
  MANUAL_SORT,
  sortGames,
  sortLabel,
  SORTS,
  type SortKey
} from '../sort'
import './SidePanel.css'

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
/** The add row and the five groups the design draws, before the list scrolls. */
const GROUP_MENU_ROWS = 6
/** The key the add row answers to, which is no group's id. */
const ADD_GROUP_KEY = 'add-group'

export default function SidePanel({
  games,
  groups,
  tags,
  selectedGameId,
  onSelect,
  onReorder,
  onEditGame,
  onDeleteGame,
  onAddGroup
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
  const [groupQuery, setGroupQuery] = useState('')
  /* Which of Penpot's "Menu" boards is out, at most one at a time. The Select
     Group button drops the whole list out of its row; typing in that field puts
     the same board up as the field's own suggestions, which is the list
     narrowed to what has been typed and without the row that adds to it. */
  const [openMenu, setOpenMenu] = useState<'none' | 'group' | 'group-suggest' | 'sort'>('none')
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT)
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
     search options are out, so its mounting is one of the triggers. */
  useEffect(() => {
    const el = sortFieldRef.current
    if (!el) return
    el.style.fontSize = '24px'
    if (el.scrollWidth > el.clientWidth) {
      el.style.fontSize = `${Math.floor(24 * (el.clientWidth / el.scrollWidth))}px`
    }
  }, [sortKey, searchOptionsOpen])

  function addTag(): void {
    const id = nextTagFilterId.current++
    setTagFilters((list) => [...list, { id, text: '' }])
    setNewTagId(id)
  }

  /** What a chip was left holding. Nothing in it takes the chip away. */
  function commitTag(id: number, text: string): void {
    setNewTagId((current) => (current === id ? null : current))
    setTagFilters((list) =>
      text.trim() === ''
        ? list.filter((chip) => chip.id !== id)
        : list.map((chip) => (chip.id === id ? { ...chip, text: text.trim() } : chip))
    )
  }

  /** Takes the chip off the row. The tag itself is the games' and stays. */
  function deleteTag(id: number): void {
    setNewTagId((current) => (current === id ? null : current))
    setTagFilters((list) => list.filter((chip) => chip.id !== id))
  }

  // Any click or Escape dismisses the context menu.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const group = groupQuery.trim().toLowerCase()
    /* Every chip on the row is a condition, so a game has to answer to all of
       them to stay in the list. A chip is matched against the names the game is
       filed under the way the Select Group field is matched against its group —
       on what it contains — so a part of a name is enough. A chip still being
       written is not a condition yet. */
    const named = new Map(tags.map((tag) => [tag.id, tag.name.toLowerCase()]))
    const terms = tagFilters.map((chip) => chip.text.trim().toLowerCase()).filter((t) => t !== '')
    return games.filter((g) => {
      const matchesQuery =
        !q || g.title.toLowerCase().includes(q) || (g.shortName ?? '').toLowerCase().includes(q)
      const matchesGroup = !group || (g.groupName ?? '').toLowerCase().includes(group)
      const matchesTags = terms.every((term) =>
        g.tagIds.some((tagId) => (named.get(tagId) ?? '').includes(term))
      )
      return matchesQuery && matchesGroup && matchesTags
    })
  }, [games, query, groupQuery, tagFilters, tags])

  /* What the Sort field asks for. "手動並び順" is the list's own stored order —
     `sort_order`, which starts as the order the games were registered in and is
     only ever changed by the drag handle — so it is the one face of the list
     that can be dragged; every other one is a view over it, and the handle is
     not drawn at all under those. */
  const ordered = useMemo(() => sortGames(filtered, sortKey), [filtered, sortKey])
  const canReorder = sortKey === MANUAL_SORT

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
        const queue = [...dragOrder]
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
    const typed = groupQuery.trim().toLowerCase()
    const rows = groups
      .filter((group) => openMenu === 'group' || group.name.toLowerCase().includes(typed))
      .map((group) => ({ key: String(group.id), label: group.name, color: group.color }))
    return openMenu === 'group'
      ? [{ key: ADD_GROUP_KEY, label: 'グループを追加 ＋' }, ...rows]
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
      <div className="clock">
        <span className="clock-date" ref={dateRef}>
          {dateLabel}
        </span>
        <span className="clock-time">{timeLabel}</span>
      </div>

      <div className="home-button">
        <span className="home-button-diamond">♦</span>
        <span className="home-button-word">&nbsp;home&nbsp;</span>
        <span className="home-button-diamond">♦</span>
      </div>

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
            title="検索"
            aria-label="検索"
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
                      setGroupQuery(e.target.value)
                      setOpenMenu(e.target.value.trim() ? 'group-suggest' : 'none')
                    }}
                    onFocus={() => {
                      if (groupQuery.trim()) setOpenMenu('group-suggest')
                    }}
                    onBlur={() => setOpenMenu((menu) => (menu === 'group-suggest' ? 'none' : menu))}
                  />
                  {groupQuery && (
                    <button
                      className="select-clear"
                      onClick={() => {
                        setGroupQuery('')
                        setOpenMenu('none')
                      }}
                      title="グループの絞り込みを解除"
                      aria-label="グループの絞り込みを解除"
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  )}
                </div>
                {/* Penpot: Show List of Group — drops the Menu below the row. */}
                <button
                  className="select-caret"
                  onClick={() => setOpenMenu((menu) => (menu === 'group' ? 'none' : 'group'))}
                  title="グループ一覧"
                  aria-label="グループ一覧"
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
                  aria-label="並び順"
                />
                <button
                  className="select-caret sort"
                  onClick={() => setOpenMenu((menu) => (menu === 'sort' ? 'none' : 'sort'))}
                  title="並び順一覧"
                  aria-label="並び順一覧"
                  aria-expanded={openMenu === 'sort'}
                >
                  ▼
                </button>
                {/* Penpot: Add Tag — 111x40. What it puts out is the row of
                    chips below, which the design does not draw. */}
                <button className="add-tag" onClick={addTag} title="タグで絞り込む">
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
            maxRows={GROUP_MENU_ROWS}
            onPick={(key) => {
              setOpenMenu('none')
              if (key === ADD_GROUP_KEY) {
                onAddGroup()
                return
              }
              const picked = groups.find((group) => String(group.id) === key)
              if (picked) setGroupQuery(picked.name)
            }}
            onDismiss={() => setOpenMenu('none')}
            anchorRef={groupRowRef}
          />
        )}

        {/* The Sort menu is the same board, dropped out of the row below. Its
            list is fixed, so every row of it stands. */}
        {searchOptionsExpanded && openMenu === 'sort' && (
          <OptionMenu
            options={SORTS.map((sort) => ({ key: sort.key, label: sort.label }))}
            top={SORT_MENU_TOP}
            maxRows={SORTS.length}
            onPick={(key) => {
              setSortKey(key as SortKey)
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
          title={searchOptionsExpanded ? '検索オプションを閉じる' : '検索オプションを開く'}
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
                const { x, y } = designPointWithin(e.clientX, e.clientY)
                setMenu({ game, x, y })
              }}
            >
              <span className={`game-icon ${game.iconPath ? '' : 'empty'}`}>
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
                  title="ドラッグして並び替え"
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
              label: '情報の変更',
              onSelect: () => {
                onEditGame(menu.game)
                setMenu(null)
              }
            },
            {
              label: '削除',
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
