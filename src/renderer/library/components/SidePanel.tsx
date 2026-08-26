import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameWithStats } from '../../../shared/db-types'
import { fileUrl, formatClock } from '../format'
import './SidePanel.css'

interface Props {
  games: GameWithStats[]
  selectedGameId: number | null
  onSelect: (gameId: number) => void
  onReorder: (orderedIds: number[]) => void
  onEditGame: (game: GameWithStats) => void
  onDeleteGame: (gameId: number) => void
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

export default function SidePanel({
  games,
  selectedGameId,
  onSelect,
  onReorder,
  onEditGame,
  onDeleteGame
}: Props): React.JSX.Element {
  const [now, setNow] = useState(new Date())
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOrder, setDragOrder] = useState<number[] | null>(null)
  const [searchOptionsOpen, setSearchOptionsOpen] = useState(false)
  const [groupQuery, setGroupQuery] = useState('')
  const [sortQuery, setSortQuery] = useState('')
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const dateRef = useRef<HTMLSpanElement | null>(null)

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
    return games.filter((g) => {
      const matchesQuery =
        !q || g.title.toLowerCase().includes(q) || (g.shortName ?? '').toLowerCase().includes(q)
      const matchesGroup = !group || (g.groupName ?? '').toLowerCase().includes(group)
      return matchesQuery && matchesGroup
    })
  }, [games, query, groupQuery])

  // While dragging, the list renders `dragOrder` so rows swap under the cursor;
  // the real reorder is only committed on release.
  const rows = useMemo(() => {
    if (!dragOrder) return filtered
    const byId = new Map(filtered.map((g) => [g.id, g]))
    return dragOrder.map((id) => byId.get(id)).filter((g): g is GameWithStats => !!g)
  }, [filtered, dragOrder])

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
    setDragOrder(filtered.map((g) => g.id))
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
      const before = filtered.map((g) => g.id)
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
          <input
            className="search-input"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="search-submit"
            onClick={() => setQuery('')}
            title="検索をクリア"
            aria-label="検索をクリア"
          >
            <i className="fa-brands fa-sistrix" />
          </button>
        </div>

        {/* Penpot: Select Group / Select Tag and Choose Way To Sort — hidden in
            the design until the search options are stretched open. Group, tag
            and sort management are deferred, so these are inert placeholders. */}
        {searchOptionsOpen && (
          <>
            <div className="select-row">
              <input
                className="select-field"
                placeholder="Select Group..."
                value={groupQuery}
                onChange={(e) => setGroupQuery(e.target.value)}
              />
              {/* Picking from a list of groups is deferred. */}
              <div className="select-caret" title="グループ一覧（未実装）">
                ▼
              </div>
            </div>

            <div className="select-row">
              <input
                className="select-field sort"
                placeholder="Sort..."
                value={sortQuery}
                onChange={(e) => setSortQuery(e.target.value)}
              />
              {/* Sort order and tag management are deferred. */}
              <div className="select-caret sort" title="並び順一覧（未実装）">
                ▼
              </div>
              <div className="add-tag" title="タグ追加（未実装）">
                Add Tag
              </div>
            </div>
          </>
        )}

        {/* Penpot: Strech / Shrink Search Option — the same 305x15 bar, one
            replacing the other as the options open and close. */}
        <button
          className="search-strech"
          onClick={() => setSearchOptionsOpen((v) => !v)}
          title={searchOptionsOpen ? '検索オプションを閉じる' : '検索オプションを開く'}
        >
          {searchOptionsOpen ? '▲' : '▼'}
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
                {game.iconPath ? <img src={fileUrl(game.iconPath)} alt="" /> : null}
              </span>
              {/* The short name stands in only when the game opts into it. */}
              <span className="game-name">
                {game.useShortName && game.shortName ? game.shortName : game.title}
              </span>
              {/* Reordering starts here and nowhere else: press the handle and
                  drag, and the rows swap under the pointer as you move. */}
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
            </div>
            <div className="game-column-border" />
          </li>
        ))}
      </ul>

      {menu && (
        <div
          className="game-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onEditGame(menu.game)
              setMenu(null)
            }}
          >
            情報の変更
          </button>
          <button
            className="danger"
            onClick={() => {
              onDeleteGame(menu.game.id)
              setMenu(null)
            }}
          >
            削除
          </button>
        </div>
      )}
    </aside>
  )
}
