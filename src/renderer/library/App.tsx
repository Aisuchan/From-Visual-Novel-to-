import { useEffect, useRef, useState } from 'react'
import type {
  FooterStats,
  GameWithStats,
  Group,
  Tag,
  NewGameInput,
  NewGroupInput,
  ProgressState
} from '../../shared/db-types'
import { useUiScale } from './useUiScale'
import Header from './components/Header'
import SidePanel from './components/SidePanel'
import GameDetail from './components/GameDetail'
import AddThumbnail from './components/AddThumbnail'
import FooterBar from './components/FooterBar'
import AddGameDialog from './components/AddGameDialog'
import NewGroupSetting from './components/NewGroupSetting'
import ConfirmDialog from './components/ConfirmDialog'
import Confetti, { type ConfettiClip } from './components/Confetti'
import Balloons from './components/Balloons'
import './App.css'

type MainView = 'game' | 'add-thumbnail'

export default function App(): React.JSX.Element {
  const [games, setGames] = useState<GameWithStats[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [footerStats, setFooterStats] = useState<FooterStats | null>(null)
  const [showAddGame, setShowAddGame] = useState(false)
  // The Select Group menu's list, and the New Group Setting board that adds
  // to it. The board is the shell's rather than the side panel's: it is 416
  // wide and stands over the whole window, as every other dialog does.
  const [groups, setGroups] = useState<Group[]>([])
  const [showNewGroup, setShowNewGroup] = useState(false)
  /* The tag vocabulary. It is the shell's rather than either screen's: the Add
     Game dialog names a game's tags out of it and the side panel matches its
     filter chips against it, and both want it in hand rather than a round trip
     away — the dialog's chips have to stand as it opens, or an OK pressed
     before the names arrived would write the game's tags away. */
  const [tags, setTags] = useState<Tag[]>([])
  const [editingGame, setEditingGame] = useState<GameWithStats | null>(null)
  /* The game the side panel has asked to delete. Deleting one takes its
     sessions, routes and images with it, so it is asked after first — the same
     board the Route panel asks with. */
  const [deletingGameId, setDeletingGameId] = useState<number | null>(null)
  const [playingGameId, setPlayingGameId] = useState<number | null>(null)
  // The finale covers the whole window — header, footer and side panel with it
  // — so it is the shell's to run rather than the board's.
  const [celebration, setCelebration] = useState<ConfettiClip | null>(null)
  // The confetti's last seconds, which the balloons leave on too.
  const [finishing, setFinishing] = useState(false)
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
      current !== null && list.some((game) => game.id === current) ? current : (list[0]?.id ?? null)
    )
  }

  async function refreshGroups(): Promise<void> {
    setGroups(await window.library.listGroups())
  }

  async function refreshTags(): Promise<void> {
    setTags(await window.library.listTags())
  }

  async function refreshFooterStats(): Promise<void> {
    setFooterStats(await window.library.getFooterStats())
  }

  useEffect(() => {
    refreshGames()
    refreshGroups()
    refreshTags()
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
    // The Group field is free text, so registering a game can name a group the
    // menu has never heard of; the list adopts it on the next read. The Tag row
    // is what writes the vocabulary at all, so that is read again too.
    await refreshGroups()
    await refreshTags()
    setSelectedGameId(created.id)
  }

  async function handleAddGroup(input: NewGroupInput): Promise<void> {
    setGroups(await window.library.addGroup(input))
    setShowNewGroup(false)
  }

  async function handleUpdateGame(input: NewGameInput): Promise<void> {
    if (!editingGame) return
    await window.library.updateGame(editingGame.id, input)
    setEditingGame(null)
    await refreshGames()
    await refreshGroups()
    await refreshTags()
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

  async function handleSetProgress(
    gameId: number,
    state: ProgressState | null,
    score: number | null
  ): Promise<void> {
    try {
      await window.library.setProgress(gameId, state, score)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('進行状況を保存できませんでした', err)
      return
    }
    await refreshGames()
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
        tags={tags}
        isPlaying={playingGameId === selectedGame.id}
        onLaunch={handleLaunch}
        onEditPlayTime={handleEditPlayTime}
        onOpenThumbnails={() => setMainView('add-thumbnail')}
        onSetProgress={handleSetProgress}
        onCelebrate={(on) => {
          setCelebration(on ? 'ok' : null)
          setFinishing(false)
        }}
        onCelebrateRoute={() => {
          setCelebration('clear')
          setFinishing(false)
        }}
      />
    )
  }

  return (
    <div className="app-shell" ref={shellRef}>
      <Header />

      <div className="app-body">
        <SidePanel
          games={games}
          groups={groups}
          tags={tags}
          selectedGameId={selectedGameId}
          onSelect={setSelectedGameId}
          onReorder={handleReorder}
          onEditGame={setEditingGame}
          onDeleteGame={setDeletingGameId}
          onAddGroup={() => setShowNewGroup(true)}
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

      {celebration && (
        <>
          <Confetti
            clip={celebration}
            onFinishing={() => setFinishing(true)}
            onEnded={() => {
              setCelebration(null)
              setFinishing(false)
            }}
          />
          {/* The balloons belong to the game's own finale. */}
          {celebration === 'ok' && <Balloons leaving={finishing} />}
        </>
      )}

      {showAddGame && (
        <AddGameDialog
          groups={groups}
          onGroupsChanged={setGroups}
          tags={tags}
          onCancel={() => setShowAddGame(false)}
          onSubmit={handleAddGame}
        />
      )}

      {editingGame && (
        <AddGameDialog
          key={editingGame.id}
          game={editingGame}
          groups={groups}
          onGroupsChanged={setGroups}
          tags={tags}
          onCancel={() => setEditingGame(null)}
          onSubmit={handleUpdateGame}
        />
      )}

      {showNewGroup && (
        <NewGroupSetting onCancel={() => setShowNewGroup(false)} onSubmit={handleAddGroup} />
      )}

      {deletingGameId !== null && (
        <ConfirmDialog
          title="delete game"
          message="このゲームを削除しますか？"
          onCancel={() => setDeletingGameId(null)}
          onConfirm={() => {
            const gameId = deletingGameId
            setDeletingGameId(null)
            handleDeleteGame(gameId)
          }}
        />
      )}
    </div>
  )
}
