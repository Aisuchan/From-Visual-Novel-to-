import { useEffect, useRef, useState } from 'react'
import { toDateKey } from './format'
import { setLanguage, t } from '../../shared/i18n'
import type {
  AppSettings,
  FooterStats,
  GameReference,
  GameWithStats,
  Group,
  Plan,
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
import CalendarFlip, { FLIP_TOTAL_MS } from './components/CalendarFlip'
import PlaytimeGraph from './components/PlaytimeGraph'
import FooterBar from './components/FooterBar'
import AddGameDialog from './components/AddGameDialog'
import NewGroupSetting from './components/NewGroupSetting'
import ConfirmDialog from './components/ConfirmDialog'
import ContextMenu from './components/ContextMenu'
import { useContextMenuDismiss } from './context-menu'
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

/** How long a board takes to fade in. Kept in step with `board-fade-in` in
    App.css, which is what the Calender board's own cells wait out. */
const BOARD_FADE_MS = 300

/** The shell's own width in design pixels, which a measured point is scaled
    back by: the side panel's 335 and the content column's 1585. */
const SHELL_WIDTH = 1920
/* Penpot: Right Click Menu — 201 wide, and two options tall at the design's own
   row and gap plus its 10 of padding either side. */
const GROUP_MENU_WIDTH = 201
const GROUP_MENU_HEIGHT = 10 + 42 * 2 + 5 + 10

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
  /* **A group is edited and deleted from the list it stands in.** The four
     screens that drop that list — the side panel, the Home board, the PlayTime
     Graph and the Add Game dialog — all hand the press up here rather than
     answering it themselves: the list is the shell's, the board that edits one
     is the shell's, and the same right press would otherwise be written out
     four times. What they hand up is the press itself, so the plate is placed
     against the shell the way every other one in the app is. */
  const [groupMenu, setGroupMenu] = useState<{ group: Group; left: number; top: number } | null>(
    null
  )
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null)
  const groupMenuOpener = useContextMenuDismiss(groupMenu !== null, () => setGroupMenu(null))
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
    vndbReleaseLanguage: 'en',
    screenshotFormat: 'png',
    videoFormat: 'mp4',
    audioFormat: 'mp3',
    homeLayout: 'grid',
    homeColumns: '5',
    homeSpines: '25',
    noticeSeen: '',
    graphPeriod: 'this-week',
    overlayCorner: 'bottom-right',
    overlayDisplay: 'primary',
    animations: 'on',
    screenshotToGallery: 'off',
    videoToGallery: 'off',
    overlaySize: 'medium',
    crackerSound: 'on',
    balloonSound: 'on',
    screenshotSound: 'off',
    videoSound: 'off',
    audioSound: 'off',
    launchAtLogin: 'off',
    launchWindowMode: 'window',
    gpuMode: 'auto',
    backupOnLaunch: 'off',
    backupDirectory: '',
    backupRestorePath: '',
    lastSaveScreenshot: '',
    lastSaveVideo: '',
    lastSaveAudio: ''
  })
  /* The アニメーション row, written onto the document rather than passed down:
     the stylesheet's own kill switch is keyed on it, and so is `motion.ts`,
     which is what the movements the app times itself read.

     Written during the render rather than from an effect on purpose. A child's
     effects run before its parent's, so a board mounting in the same commit
     that turned the row off would set its own clocks against the attribute as
     it was before the shell had touched it. */
  /* The 言語/language row. Written during the render for the same reason the
     attribute below it is: `t` is a plain function read at the moment a run is
     drawn, so it has to be right before any child draws one. Changing the row
     re-renders the whole tree — the settings are the shell's state — which is
     what puts the new language on the screen without a Context or a restart. */
  setLanguage(settings.language)

  document.documentElement.dataset.animations = settings.animations
  const animate = settings.animations === 'on'
  /* The 音声 tab's two rows, written the same way and read by `sound.ts`: both
     of these sounds are fired from inside an effect's own closure, where a
     prop would be the one that effect was set up with. */
  document.documentElement.dataset.crackerSound = settings.crackerSound
  document.documentElement.dataset.balloonSound = settings.balloonSound
  /* Today's own plans that asked to be notified. Nothing raises a notification
     yet — the flag is stored and read — but the footer's Notification row
     stands for these: a mark while there are any, and a press that puts the
     day up. Read again every minute, which is what carries it over midnight as
     well as picking up a plan written anywhere else. */
  const [duePlans, setDuePlans] = useState<Plan[]>([])
  /* The day those plans are for, read beside them so that a confirmation — which
     is about a day — can be compared against it. The minute the two disagree is
     midnight, and the mark comes back with the new day's own plans. */
  const [dueDay, setDueDay] = useState('')
  const [editingGame, setEditingGame] = useState<GameWithStats | null>(null)
  /* The game the side panel has asked to delete. Deleting one takes its
     sessions, routes and images with it, so it is asked after first — the same
     board the Route panel asks with. */
  const [deletingGameId, setDeletingGameId] = useState<number | null>(null)
  /* Why a launch could not be made, which is a notice rather than a question:
     the Play button was pressed and nothing ran. */
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [playingGameId, setPlayingGameId] = useState<number | null>(null)
  // The finale covers the whole window — header, footer and side panel with it
  // — so it is the shell's to run rather than the board's.
  const [celebration, setCelebration] = useState<ConfettiClip | null>(null)
  // The confetti's last seconds, which the balloons leave on too.
  const [finishing, setFinishing] = useState(false)
  // Which board fills the content column: Penpot's "Game", "Add Thumbnail",
  // "Setting", "Home" or "Calender".
  const [mainView, setMainView] = useState<MainView>('game')
  /* The run of pages the Calender board is arrived at through, or null while
     none is turning. It is the run's own number rather than a flag so that
     coming back to the board while the last one is still going restarts it:
     the overlay is keyed on this, and a new number is a new run. */
  const [calendarFlip, setCalendarFlip] = useState<number | null>(null)
  const calendarFlips = useRef(0)
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

  async function refreshDuePlans(): Promise<void> {
    const today = toDateKey(new Date())
    const rows = await window.library.listPlans(today, today)
    setDueDay(today)
    setDuePlans(rows.filter((plan) => plan.notify))
  }

  useEffect(() => {
    refreshGames()
    refreshGroups()
    refreshTags()
    refreshSettings()
    refreshFooterStats()
    refreshDuePlans()
    const due = setInterval(refreshDuePlans, 60000)

    const unsubscribe = window.library.onSessionEnded(() => {
      setPlayingGameId(null)
      refreshGames()
      refreshFooterStats()
    })
    /* The other half of the same news: a spawn that failed once the session was
       already under way, which is asynchronous and so cannot come back as the
       call's own error. The session's end is reported beside it, so the board
       is already back to itself by the time this is read. */
    const unfailed = window.library.onSessionFailed(({ message }) => {
      setPlayingGameId(null)
      setLaunchError(message)
    })
    return () => {
      clearInterval(due)
      unsubscribe()
      unfailed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* The Calender board is turned to rather than simply shown: the two months
     before it are flicked away by their top-right corners, and the board fades
     up once they are gone. It is mounted under those pages from the first
     frame, so they are what its own read happens behind — the same thing the
     board slot's fade does for the boards that arrive without them. Leaving
     the board puts a run that is still going away with it. */
  useEffect(() => {
    // The pages are the board's own arrival, so the アニメーション row turned
    // off is a board that is simply there — and nothing for its cells to wait.
    if (mainView !== 'calendar' || !animate) {
      setCalendarFlip(null)
      return
    }
    calendarFlips.current += 1
    setCalendarFlip(calendarFlips.current)
  }, [mainView, animate])

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

  /* The row's own press, in the shell's own design pixels. The shell is laid
     out at 1920 under a fractional zoom, so a client point is scaled back by
     that known width — the conversion every menu in the app makes against a box
     whose design width it knows. */
  function openGroupMenu(key: string, event: React.MouseEvent): void {
    /* A menu's rows are keyed by the group's id, and the rows that are not a
       group — 「グループを追加 ＋」 and 「すべて」 — carry a word for a key
       instead, so they simply match nothing and the press does nothing. */
    const group = groups.find((one) => String(one.id) === key)
    const shell = document.querySelector('.app-shell')
    if (!group || !shell) return
    event.preventDefault()
    groupMenuOpener.current = event.currentTarget as HTMLElement
    const box = shell.getBoundingClientRect()
    const scale = box.width / SHELL_WIDTH
    /* Held inside the shell, which is what clips: the plate is drawn at the
       pointer and a press near an edge would otherwise put it half outside. */
    setGroupMenu({
      group,
      left: Math.min((event.clientX - box.left) / scale, SHELL_WIDTH - GROUP_MENU_WIDTH),
      top: Math.min((event.clientY - box.top) / scale, box.height / scale - GROUP_MENU_HEIGHT)
    })
  }

  async function handleEditGroup(input: NewGroupInput): Promise<void> {
    const group = editingGroup
    setEditingGroup(null)
    if (!group) return
    setGroups(await window.library.updateGroup(group.id, input))
    /* A rename is written onto the games as well, so the list they are drawn
       from has to be read again. */
    await refreshGames()
  }

  async function handleDeleteGroup(group: Group): Promise<void> {
    setGroups(await window.library.deleteGroup(group.id))
    await refreshGames()
  }

  /* The Game Info board's own gear. It writes four columns and nothing else, so
     what comes back is the game — and the library is read again, the board being
     drawn from that list rather than from what the panel was handed. */
  async function handleSaveReference(gameId: number, input: GameReference): Promise<void> {
    await window.library.setGameReference(gameId, input)
    await refreshGames()
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
      console.error(t('進行状況を保存できませんでした'), err)
      return
    }
    await refreshGames()
  }

  async function handleReorder(orderedIds: number[]): Promise<void> {
    await window.library.reorderGames(orderedIds)
    await refreshGames()
  }

  /* An error thrown inside an `ipcMain.handle` reaches the renderer wrapped in
     the channel's own name — "Error invoking remote method 'session:start':
     Error: ..." — and what is worth reading is the sentence at the end of it. */
  function launchMessage(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err)
    const at = text.lastIndexOf('Error: ')
    return at < 0 ? text : text.slice(at + 'Error: '.length)
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
      /* A launch that could not be made is said rather than logged: the button
         was pressed and nothing happened, and the reason — most often that the
         file has been moved or deleted since the game was registered — is the
         one thing that makes it fixable. */
      setLaunchError(launchMessage(err))
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
          onGroupContext={openGroupMenu}
          tags={tags}
          onGamesChanged={refreshGames}
          layout={settings.homeLayout}
          onLayoutChange={async (homeLayout) =>
            setSettings(await window.library.setSettings({ homeLayout }))
          }
          columns={settings.homeColumns}
          onColumnsChange={async (homeColumns) =>
            setSettings(await window.library.setSettings({ homeColumns }))
          }
          spines={settings.homeSpines}
          onSpinesChange={async (homeSpines) =>
            setSettings(await window.library.setSettings({ homeSpines }))
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
          tags={tags}
          groups={groups}
          onGroupContext={openGroupMenu}
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
      /* The board is held back behind the pages being turned off the column
         and the fade that follows them, so that is what its own cells wait out
         before they are read into. */
      return (
        <Calendar
          games={games}
          onPlansChanged={refreshDuePlans}
          onOpenGraph={() => setMainView('graph')}
          arriveDelay={animate ? FLIP_TOTAL_MS + BOARD_FADE_MS : 0}
        />
      )
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
      return <div className="empty-state">{t('「Add Game +」からゲームを登録してください')}</div>
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
        onGamesChanged={refreshGames}
        onSaveReference={handleSaveReference}
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
          onGroupContext={openGroupMenu}
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
            }${mainView === 'calendar' ? ' after-flip' : ''}`}
            /* The Calender board's own pages are turned off an empty column,
               so its fade waits the whole run out and the board arrives once
               they are gone. */
            style={
              mainView === 'calendar' && animate
                ? { animationDelay: `${FLIP_TOTAL_MS}ms` }
                : undefined
            }
            key={mainView}
          >
            {renderBoard(mainView)}
          </div>

          {/* The pages are turned over the Main Display alone, so they hang
              off the column rather than off the shell the way the finale
              does. */}
          {calendarFlip !== null && (
            <CalendarFlip key={calendarFlip} onDone={() => setCalendarFlip(null)} />
          )}
        </div>
      </div>

      <FooterBar
        stats={footerStats}
        onAddGame={() => setShowAddGame(true)}
        onToggleSetting={() =>
          setMainView((current) => (current === 'setting' ? 'game' : 'setting'))
        }
        settingOpen={mainView === 'setting'}
        /* What the footer's own "Notification▲" row stands for. The row puts
           Penpot's "Notification" board up over itself, so the plans go down
           rather than only their count; opening or closing it is the row's own
           business and is held there. */
        duePlans={duePlans}
        /* Whether today's have been confirmed on the board itself, which is
           what takes the mark off the row without taking the plans away. */
        dueSeen={dueDay !== '' && settings.noticeSeen === dueDay}
        onDueSeen={async () =>
          setSettings(await window.library.setSettings({ noticeSeen: dueDay }))
        }
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
          onGroupContext={openGroupMenu}
          onGroupsChanged={setGroups}
          tags={tags}
          vndbReleaseLanguage={settings.vndbReleaseLanguage}
          onCancel={() => setShowAddGame(false)}
          onSubmit={handleAddGame}
        />
      )}

      {editingGame && (
        <AddGameDialog
          key={editingGame.id}
          game={editingGame}
          groups={groups}
          onGroupContext={openGroupMenu}
          onGroupsChanged={setGroups}
          tags={tags}
          vndbReleaseLanguage={settings.vndbReleaseLanguage}
          onCancel={() => setEditingGame(null)}
          onSubmit={handleUpdateGame}
        />
      )}

      {showNewGroup && (
        <NewGroupSetting onCancel={() => setShowNewGroup(false)} onSubmit={handleAddGroup} />
      )}

      {/* The two things a group in the list can be made to do, on the same
          plate and the same rule every other right press in the app follows. */}
      {groupMenu && (
        <ContextMenu
          style={{ left: `${groupMenu.left}px`, top: `${groupMenu.top}px` }}
          items={[
            {
              label: t('編集'),
              onSelect: () => {
                setEditingGroup(groupMenu.group)
                setGroupMenu(null)
              }
            },
            {
              label: t('削除'),
              danger: true,
              onSelect: () => {
                setDeletingGroup(groupMenu.group)
                setGroupMenu(null)
              }
            }
          ]}
        />
      )}

      {editingGroup && (
        <NewGroupSetting
          group={editingGroup}
          onCancel={() => setEditingGroup(null)}
          onSubmit={handleEditGroup}
        />
      )}

      {deletingGroup && (
        <ConfirmDialog
          title="delete group"
          message={t('「{0}」を削除しますか？', deletingGroup.name)}
          note={t('このグループのゲームはグループなしになります。')}
          onCancel={() => setDeletingGroup(null)}
          onConfirm={() => {
            const group = deletingGroup
            setDeletingGroup(null)
            void handleDeleteGroup(group)
          }}
        />
      )}

      {launchError !== null && (
        <ConfirmDialog
          title="launch failed"
          message={launchError}
          onConfirm={() => setLaunchError(null)}
        />
      )}

      {deletingGameId !== null && (
        <ConfirmDialog
          title="delete game"
          message={t('このゲームを削除しますか？')}
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
