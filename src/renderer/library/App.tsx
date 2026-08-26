import { useEffect, useRef, useState } from 'react'
import type { FooterStats, GameWithStats, NewGameInput } from '../../shared/db-types'
import { useUiScale } from './useUiScale'
import Header from './components/Header'
import SidePanel from './components/SidePanel'
import GameDetail from './components/GameDetail'
import FooterBar from './components/FooterBar'
import AddGameDialog from './components/AddGameDialog'
import './App.css'

export default function App(): React.JSX.Element {
  const [games, setGames] = useState<GameWithStats[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [footerStats, setFooterStats] = useState<FooterStats | null>(null)
  const [showAddGame, setShowAddGame] = useState(false)
  const [editingGame, setEditingGame] = useState<GameWithStats | null>(null)
  const [playingGameId, setPlayingGameId] = useState<number | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)

  useUiScale(shellRef)

  async function refreshGames(): Promise<void> {
    const list = await window.library.listGames()
    setGames(list)
    if (selectedGameId === null && list.length > 0) {
      setSelectedGameId(list[0].id)
    }
  }

  async function refreshFooterStats(): Promise<void> {
    setFooterStats(await window.library.getFooterStats())
  }

  useEffect(() => {
    refreshGames()
    refreshFooterStats()

    const unsubscribe = window.library.onSessionEnded(() => {
      setPlayingGameId(null)
      refreshGames()
      refreshFooterStats()
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedGame = games.find((g) => g.id === selectedGameId) ?? null

  async function handleAddGame(input: NewGameInput): Promise<void> {
    const created = await window.library.addGame(input)
    setShowAddGame(false)
    await refreshGames()
    setSelectedGameId(created.id)
  }

  async function handleUpdateGame(input: NewGameInput): Promise<void> {
    if (!editingGame) return
    await window.library.updateGame(editingGame.id, input)
    setEditingGame(null)
    await refreshGames()
  }

  async function handleDeleteGame(gameId: number): Promise<void> {
    await window.library.deleteGame(gameId)
    if (selectedGameId === gameId) setSelectedGameId(null)
    await refreshGames()
  }

  async function handleEditPlayTime(gameId: number, seconds: number): Promise<void> {
    await window.library.setTotalPlaySeconds(gameId, seconds)
    await refreshGames()
    await refreshFooterStats()
  }

  async function handleReorder(orderedIds: number[]): Promise<void> {
    await window.library.reorderGames(orderedIds)
    await refreshGames()
  }

  function stepSelection(direction: 1 | -1): void {
    if (games.length === 0 || selectedGameId === null) return
    const index = games.findIndex((g) => g.id === selectedGameId)
    const nextIndex = (index + direction + games.length) % games.length
    setSelectedGameId(games[nextIndex].id)
  }

  async function handleLaunch(opts: {
    recordTime: boolean
    useRecorderPanel: boolean
    runAsAdmin: boolean
  }): Promise<void> {
    if (!selectedGame) return
    setPlayingGameId(selectedGame.id)
    try {
      await window.library.startSession({ gameId: selectedGame.id, ...opts })
    } catch (err) {
      setPlayingGameId(null)
      // eslint-disable-next-line no-console
      console.error(err)
    }
  }

  return (
    <div className="app-shell" ref={shellRef}>
      <Header />

      <div className="app-body">
        <SidePanel
          games={games}
          selectedGameId={selectedGameId}
          onSelect={setSelectedGameId}
          onReorder={handleReorder}
          onEditGame={setEditingGame}
          onDeleteGame={handleDeleteGame}
        />

        <div className="main-column">
          {selectedGame ? (
            <GameDetail
              game={selectedGame}
              isPlaying={playingGameId === selectedGame.id}
              onLaunch={handleLaunch}
              onPrev={() => stepSelection(-1)}
              onNext={() => stepSelection(1)}
              onEditPlayTime={handleEditPlayTime}
            />
          ) : (
            <div className="empty-state">「Add Game +」からゲームを登録してください</div>
          )}
        </div>
      </div>

      <FooterBar stats={footerStats} onAddGame={() => setShowAddGame(true)} />

      {showAddGame && (
        <AddGameDialog onCancel={() => setShowAddGame(false)} onSubmit={handleAddGame} />
      )}

      {editingGame && (
        <AddGameDialog
          key={editingGame.id}
          game={editingGame}
          onCancel={() => setEditingGame(null)}
          onSubmit={handleUpdateGame}
        />
      )}
    </div>
  )
}
