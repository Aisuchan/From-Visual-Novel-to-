import { useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
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
import Setting from './components/Setting'
import Home from './components/Home'
import Calendar from './components/Calendar'
import PlaytimeGraph from './components/PlaytimeGraph'
import FooterBar from './components/FooterBar'
import AddGameDialog from './components/AddGameDialog'
import NewGroupSetting from './components/NewGroupSetting'
import ConfirmDialog from './components/ConfirmDialog'
import Confetti, { type ConfettiClip } from './components/Confetti'
import Balloons from './components/Balloons'
import './App.css'

type MainView =
  | 'game'
  | 'add-thumbnail'
  | 'setting'
  | 'home'
  | 'calendar'
  | 'graph'

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
  /* What the Setting board's rows are set to. They are the app's own rather
     than a game's, so they are the shell's to hold; the board is given them
     and reports a change back rather than reading the store itself. */
  const [settings, setSettings] = useState<AppSettings>({
    // The store's own defaults, which stand for the frame before it answers.
    language: 'ja',
    screenshotFormat: 'png',
    videoFormat: 'mp4',
    audioFormat: 'mp3',
    homeLayout: 'grid',
    graphPeriod: 'this-week'
  })
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
  // Which board fills the content column: Penpot's "Game", "Add Thumbnail",
  // "Setting", "Home" or "Calender".
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

  async function refreshSettings(): Promise<void> {
    setSettings(await window.library.getSettings())
  }

  async function refreshFooterStats(): Promise<void> {
    setFooterStats(await window.library.getFooterStats())
  }

  useEffect(() => {
    refreshGames()
    refreshGroups()
    refreshTags()
    refreshSettings()
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

  /* Every screen the content column has stood on, and where in that list we
     are — what the mouse's side buttons step back and forward through. A
     screen is the board *and* the game it was for, since the same board over
     another game is somewhere else. */
  const viewHistory = useRef<{ view: MainView; gameId: number | null }[]>([])
  const historyIndex = useRef(-1)
  /** Set while a step through that list is being applied, so the two effects
      below leave it alone: it is not a move to be recorded, and restoring a
      game must not drag the board back to that game's own. */
  const stepping = useRef(false)

  // Add Thumbnail belongs to one game, so picking another returns to its Game
  // board — and so does opening a game while the Setting board is up, the side
  // panel being how a game is switched to.
  useEffect(() => {
    if (stepping.current) return
    setMainView('game')
  }, [selectedGameId])

  /* Declared after that one on purpose: effects run in the order they are
     written, so by the time this clears the flag the other has already seen
     it. React batches the pair of state changes a step makes, so both run once
     against the screen the step asked for. */
  useEffect(() => {
    if (stepping.current) {
      stepping.current = false
      return
    }
    const at = viewHistory.current[historyIndex.current]
    if (at && at.view === mainView && at.gameId === selectedGameId) return
    // A move made after stepping back drops whatever was ahead, the way a
    // browser's own history does.
    viewHistory.current = viewHistory.current.slice(0, historyIndex.current + 1)
    viewHistory.current.push({ view: mainView, gameId: selectedGameId })
    historyIndex.current = viewHistory.current.length - 1
  }, [mainView, selectedGameId])

  /* The mouse's own side pair walks that list: Chromium numbers them 3 and 4,
     which is what Windows means by back and forward, and this app is what they
     are for here — the page itself has no history for the browser to move
     through. `auxclick` is stopped as well so nothing else in the page acts on
     the same press. */
  useEffect(() => {
    const step = (back: boolean): boolean => {
      const next = historyIndex.current + (back ? -1 : 1)
      const entry = viewHistory.current[next]
      if (!entry) return false
      historyIndex.current = next
      stepping.current = true
      setSelectedGameId(entry.gameId)
      setMainView(entry.view)
      return true
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      step(event.button === 3)
    }
    const swallow = (event: MouseEvent): void => {
      if (event.button === 3 || event.button === 4) event.preventDefault()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', swallow)
    window.addEventListener('auxclick', swallow)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', swallow)
      window.removeEventListener('auxclick', swallow)
    }
  }, [])

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
    // Settings belong to the app rather than to a game, so this board stands
    // whether or not the library has one selected.
    // The library's own board, which likewise stands with no game selected.
    if (view === 'home') {
      return (
        <Home
          games={games}
          groups={groups}
          tags={tags}
          onGamesChanged={refreshGames}
          layout={settings.homeLayout}
          onLayoutChange={async (homeLayout) =>
            setSettings(await window.library.setSettings({ homeLayout }))
          }
          onSelect={(gameId) => {
            setSelectedGameId(gameId)
            // The effect below only fires when the id actually changes, and
            // the card for the game already selected must go to its board too.
            setMainView('game')
          }}
        />
      )
    }
    /* The PlayTime Graph stands in the Calender board's own slot and is
       reached from it. It is a screen of its own rather than a face of that
       one, so the mouse's side buttons step back to the calendar rather than
       past it — and the swap gets the board slot's own fade. */
    if (view === 'graph') {
      return (
        <PlaytimeGraph
          games={games}
          defaultPeriod={settings.graphPeriod}
          onSetDefaultPeriod={async (graphPeriod) =>
            setSettings(await window.library.setSettings({ graphPeriod }))
          }
          onBack={() => setMainView('calendar')}
        />
      )
    }
    // The month is the app's own too, so this board likewise stands with no
    // game selected.
    if (view === 'calendar') {
      return <Calendar onOpenGraph={() => setMainView('graph')} />
    }
    if (view === 'setting') {
      return (
        <Setting
          settings={settings}
          onChange={async (patch) => setSettings(await window.library.setSettings(patch))}
        />
      )
    }
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
          /* The panel's highlight is where the content column *is*, not what
             was last opened: the Home, Setting and Calender boards are the
             app's rather than a game's, so while one of them is up no row is
             the one being shown. The game itself is still selected — stepping back through
             the history, or pressing HOME again, returns to its board. */
          selectedGameId={
            mainView === 'home' ||
            mainView === 'setting' ||
            mainView === 'calendar' ||
            mainView === 'graph'
              ? null
              : selectedGameId
          }
          /* The board as well as the game: the effect below only fires when
             the id actually changes, so picking the game that is already
             selected — which is what the side panel shows while the Home or
             Setting board is up — left the list unable to open it at all. */
          onSelect={(gameId) => {
            setSelectedGameId(gameId)
            setMainView('game')
          }}
          onReorder={handleReorder}
          onEditGame={setEditingGame}
          onDeleteGame={setDeletingGameId}
          onAddGroup={() => setShowNewGroup(true)}
          onHome={() => setMainView((current) => (current === 'home' ? 'game' : 'home'))}
          homeOpen={mainView === 'home'}
          /* The graph is reached from the calendar and stands in its slot, so
             the clock is lit for either and takes both away again. */
          onCalendar={() =>
            setMainView((current) =>
              current === 'calendar' || current === 'graph' ? 'game' : 'calendar'
            )
          }
          calendarOpen={mainView === 'calendar' || mainView === 'graph'}
        />

        <div className="main-column">
          {/* Keyed on the board so a switch remounts the slot, which is what
              re-runs its fade-in — and starts the new board's reading on the
              same frame the fade begins. Add Thumbnail has a whole page of
              pictures to read and decode, so it fades for longer. */}
          <div
            className={`board-slot ${
              mainView === 'add-thumbnail' || mainView === 'graph' ? 'slow-fade' : ''
            }`}
            key={mainView}
          >
            {renderBoard(mainView)}
          </div>
        </div>
      </div>

      <FooterBar
        stats={footerStats}
        onAddGame={() => setShowAddGame(true)}
        onToggleSetting={() =>
          setMainView((current) => (current === 'setting' ? 'game' : 'setting'))
        }
        settingOpen={mainView === 'setting'}
      />

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
