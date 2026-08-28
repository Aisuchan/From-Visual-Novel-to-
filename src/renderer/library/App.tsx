import { useEffect, useRef, useState } from 'react'
import type { FooterStats, GameWithStats, NewGameInput } from '../../shared/db-types'
import { useUiScale } from './useUiScale'
import Header from './components/Header'
import SidePanel from './components/SidePanel'
import GameDetail from './components/GameDetail'
import AddThumbnail from './components/AddThumbnail'
import FooterBar from './components/FooterBar'
import AddGameDialog from './components/AddGameDialog'
import './App.css'

type MainView = 'game' | 'add-thumbnail'

export default function App(): React.JSX.Element {
  const [games, setGames] = useState<GameWithStats[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [footerStats, setFooterStats] = useState<FooterStats | null>(null)
  const [showAddGame, setShowAddGame] = useState(false)
  const [editingGame, setEditingGame] = useState<GameWithStats | null>(null)
  const [playingGameId, setPlayingGameId] = useState<number | null>(null)
  // Which board fills the content column: Penpot's "Game" or "Add Thumbnail".
  const [mainView, setMainView] = useState<MainView>('game')
  const shellRef = useRef<HTMLDivElement | null>(null)

  useUiScale(shellRef)

  async function refreshGames(): Promise<void> {
    const list = await window.library.listGames()
    setGames(list)
    // Functional update on purpose: this also runs from the session-ended
    // subscription, whose closure would otherwise still see the selection as
    // it was when the subscription was set up and jump back to the first game.
    setSelectedGameId((current) =>
      current !== null && list.some((game) => game.id === current)
        ? current
        : (list[0]?.id ?? null)
    )
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

  // Add Thumbnail belongs to one game; picking another returns to its Game board.
  useEffect(() => {
    setMainView('game')
  }, [selectedGameId])

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

  function renderBoard(view: MainView): React.JSX.Element {
    if (!selectedGame) {
      return <div className="empty-state">「Add Game +」からゲームを登録してください</div>
    }
    if (view === 'add-thumbnail') {
      return (
        <AddThumbnail
          game={selectedGame}
          onCancel={() => setMainView('game')}
          onApplied={async () => {
            await refreshGames()
            setMainView('game')
          }}
          onGamesChanged={refreshGames}
        />
      )
    }
    return (
      <GameDetail
        game={selectedGame}
        isPlaying={playingGameId === selectedGame.id}
        onLaunch={handleLaunch}
        onEditPlayTime={handleEditPlayTime}
        onOpenThumbnails={() => setMainView('add-thumbnail')}
      />
    )
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
          {/* Keyed on the board so a switch remounts the slot, which is what
              re-runs its fade-in — and starts the new board's reading on the
              same frame the fade begins. Add Thumbnail has a whole page of
              pictures to read and decode, so it fades for longer. */}
          <div
            className={`board-slot ${mainView === 'add-thumbnail' ? 'slow-fade' : ''}`}
            key={mainView}
          >
            {renderBoard(mainView)}
          </div>
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
