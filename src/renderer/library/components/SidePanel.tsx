import { useEffect, useMemo, useState } from 'react'
import type { GameWithStats } from '../../../shared/db-types'
import { formatClock } from '../format'
import './SidePanel.css'

interface Props {
  games: GameWithStats[]
  selectedGameId: number | null
  onSelect: (gameId: number) => void
  onReorder: (orderedIds: number[]) => void
  onDeleteSelected: (gameIds: number[]) => void
  onAddGame: () => void
}

export default function SidePanel({
  games,
  selectedGameId,
  onSelect,
  onReorder,
  onDeleteSelected,
  onAddGame
}: Props): React.JSX.Element {
  const [now, setNow] = useState(new Date())
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [dragId, setDragId] = useState<number | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const { dateLabel, timeLabel } = formatClock(now)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return games
    return games.filter(
      (g) => g.title.toLowerCase().includes(q) || (g.shortName ?? '').toLowerCase().includes(q)
    )
  }, [games, query])

  function toggleChecked(id: number): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDrop(targetId: number): void {
    if (dragId === null || dragId === targetId) return
    const ids = games.map((g) => g.id)
    const fromIndex = ids.indexOf(dragId)
    const toIndex = ids.indexOf(targetId)
    ids.splice(fromIndex, 1)
    ids.splice(toIndex, 0, dragId)
    onReorder(ids)
    setDragId(null)
  }

  return (
    <aside className="side-panel">
      <div className="clock">
        <span className="clock-date">{dateLabel}</span>
        <span className="clock-time">{timeLabel}</span>
      </div>

      <div className="home-label">◆ HOME ◆</div>

      <div className="search-row">
        <input
          className="search-input"
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="search-button"
          onClick={() => setQuery('')}
          title="検索をクリア"
          aria-label="検索をクリア"
        >
          🔍
        </button>
      </div>

      {checked.size > 0 && (
        <button
          className="delete-selected"
          onClick={() => {
            onDeleteSelected([...checked])
            setChecked(new Set())
          }}
        >
          選択した{checked.size}件を削除
        </button>
      )}

      <ul className="game-list">
        {filtered.map((game) => (
          <li
            key={game.id}
            className={`game-item ${game.id === selectedGameId ? 'active' : ''}`}
            draggable
            onDragStart={() => setDragId(game.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(game.id)}
            onClick={() => onSelect(game.id)}
          >
            <input
              type="checkbox"
              checked={checked.has(game.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleChecked(game.id)}
            />
            <span className="game-item-title">{game.shortName || game.title}</span>
            <span className="drag-handle">⠿</span>
          </li>
        ))}
      </ul>

      <button className="add-game-button" onClick={onAddGame}>
        Add Game +
      </button>
    </aside>
  )
}
