import { useCallback, useEffect, useRef, useState } from 'react'
import { formatPlaytime, toDateKey } from './format'
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
import { DEFAULT_DIRECTION, DEFAULT_SORT, sortGames } from './sort'
import Header from './components/Header'
import SidePanel from './components/SidePanel'
import GameDetail from './components/GameDetail'
import AddThumbnail from './components/AddThumbnail'
import Setting from './components/Setting'
import Home from './components/Home'
import Calendar from './components/Calendar'
import CalendarFlip, { FLIP_TOTAL_MS } from './components/CalendarFlip'
import PlaytimeGraph from './components/PlaytimeGraph'
import VoiceManager from './components/VoiceManager'
import Ledger from './components/Ledger'
import FooterBar from './components/FooterBar'
import AddGameDialog from './components/AddGameDialog'
import NewGroupSetting from './components/NewGroupSetting'
import ConfirmDialog from './components/ConfirmDialog'
import ContextMenu from './components/ContextMenu'
import { useContextMenuDismiss } from './context-menu'
import Confetti, { type ConfettiClip } from './components/Confetti'
import Balloons from './components/Balloons'
import ExtraFunction, { extraActionName, type ExtraAction } from './components/ExtraFunction'
import CsvExport from './components/CsvExport'
import FirstLaunchGuide from './components/FirstLaunchGuide'
import './App.css'

type MainView =
  | 'game'
  | 'add-thumbnail'
  | 'setting'
  | 'home'
  | 'calendar'
  | 'graph'
  | 'voice'
  | 'ledger'

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

/** The first game the side panel shows with nothing filtered — the top row of
    its default sort (プレイ順), which is what "the first game in the list" means
    on the screen. The initial selection is picked from here rather than from the
    database's own `sort_order`, so the game opened is the one at the top of the
    list rather than one sitting lower in it. */
function firstListedGameId(list: GameWithStats[]): number | null {
  return sortGames(list, DEFAULT_SORT, DEFAULT_DIRECTION[DEFAULT_SORT])[0]?.id ?? null
}

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
    groupFrame: 'on',
    screenshotToGallery: 'off',
    videoToGallery: 'off',
    audioToVoice: 'off',
    overlaySize: 'medium',
    rememberPanelPosition: 'on',
    crackerSound: 'on',
    balloonSound: 'on',
    screenshotSound: 'off',
    videoSound: 'off',
    audioSound: 'off',
    voiceVolume: 1,
    voiceInitialSearch: 'on',
    launchAtLogin: 'off',
    addGameMore: 'off',
    // Assumed seen until the store says otherwise, so a returning library does
    // not flash the coach-mark before its real settings arrive.
    guideSeen: 'on',
    launchWindowMode: 'window',
    jpFont: 'hangyaku',
    gpuMode: 'auto',
    backupOnLaunch: 'off',
    backupDirectory: '',
    backupRestorePath: '',
    lastSaveScreenshot: '',
    lastSaveVideo: '',
    lastSaveAudio: '',
    lastOpenGameId: ''
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
  /* The 日本語フォント row: written onto the document the way the animations
     row is, since the font stacks in `theme.css` are keyed on it. */
  document.documentElement.dataset.jpFont = settings.jpFont
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
  /* A hand edit that moved a game's total, waiting to be told where the
     change counts. `delta` is what the question names, signed. */
  const [playTimeEdit, setPlayTimeEdit] = useState<{
    gameId: number
    seconds: number
    delta: number
  } | null>(null)
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
  /* The game the Voice board opens narrowed to: the one whose board was up
     when ボイスマネージャー was pressed, or none. Held rather than read off the
     selection at render, so a game picked while the board is up does not
     re-narrow it. */
  const [voiceGameId, setVoiceGameId] = useState<number | null>(null)
  /* The run of pages the Calender board is arrived at through, or null while
     none is turning. It is the run's own number rather than a flag so that
     coming back to the board while the last one is still going restarts it:
     the overlay is keyed on this, and a new number is a new run. */
  const [calendarFlip, setCalendarFlip] = useState<number | null>(null)
  /* Penpot's "Extra Function" board, which the footer's otter puts in the Main
     Display's bottom-right corner. `closing` is the board on its way back
     down: it is unmounted once it has sunk, so the movement is seen both ways. */
  const [extra, setExtra] = useState<'closed' | 'open' | 'closing'>('closed')
  const extraButtonRef = useRef<HTMLButtonElement>(null)
  /* The footer's note button, which the first-launch guide is placed over. */
  const noteButtonRef = useRef<HTMLButtonElement>(null)
  const toggleExtra = useCallback(() => {
    setExtra((state) => (state === 'open' ? 'closing' : 'open'))
  }, [])
  const closeExtra = useCallback(() => {
    setExtra((state) => (state === 'open' ? 'closing' : state))
  }, [])
  /* The picture the Add Thumbnail board is to open on, and the game it is
     in — the blue circle's answer. The ref is what the "picking a game opens
     its board" effect reads: the game changes and the board asked for is the
     gallery, not the Game board that effect would put up. */
  const [galleryOpenImage, setGalleryOpenImage] = useState<number | null>(null)
  /* Which picture the Game board's carousel opens on when it comes back from
     Add Thumbnail — set by that board's CANCEL/APPLY, null to centre on the
     thumbnail as usual. Read once as the Game board mounts. */
  const [carouselFocus, setCarouselFocus] = useState<string | null>(null)
  /* The picture the Game board's carousel was on when Add Thumbnail was opened,
     which is where CANCEL brings it back to. */
  const [thumbOpenedFrom, setThumbOpenedFrom] = useState<string | null>(null)
  const galleryOpenOn = useRef<number | null>(null)
  /* What a circle has to say when it has nothing to answer with — the green
     one pressed with no picture marked R18, or the blue with no picture at
     all. A notice on the app's own board, OK being the only way out of it. */
  const [extraNotice, setExtraNotice] = useState<{ title: string; message: string } | null>(null)
  /* The CSV export dialog — Penpot's "CSV Game" and "CSV Setting" side by side,
     which the Extra Function board's yellow-green circle puts up. */
  const [showCsv, setShowCsv] = useState(false)
  /* A tag clicked under a Game board title opens the Home board narrowed to it.
     It is read once as Home mounts (the board is remounted every open), and
     cleared whenever Home is reached another way so it does not linger. */
  const [homeInitialTag, setHomeInitialTag] = useState<string | null>(null)
  /* It is about one opening of the gallery and no other. The board's own
     CANCEL and APPLY let it go, but the gallery is left by other doors too —
     a game picked in the side panel, HOME, the clock, the mouse's side
     buttons — and left through any of those it stayed set, so the gear on the
     same game opened the gallery full screen on the random picture again.
     Whatever the board is left by, the next gallery opens on its own. */
  useEffect(() => {
    if (mainView !== 'add-thumbnail') setGalleryOpenImage(null)
  }, [mainView])
  /* A random game is the side panel's own press on it: the game is selected
     and its board comes up. A random picture is one drawn out of every
     gallery at once — or, for the green circle, out of the pictures marked
     R18 — opened full screen on its game's Add Thumbnail board.
     Either way the Extra Function board is put away — what it answered with
     is a change to the display it was standing on. */
  const handleExtraAction = useCallback(
    async (action: ExtraAction) => {
      closeExtra()
      if (action === 'random-game') {
        if (games.length === 0) return
        const game = games[Math.floor(Math.random() * games.length)]
        setSelectedGameId(game.id)
        setMainView('game')
        return
      }
      /* Penpot's "Add Voice" board, in the Main Display's slot. It is the
         app's rather than a game's, the way Home is. */
      if (action === 'voice-manager') {
        /* The UI-tab ボイスマネージャーの初期検索 row: on, it opens narrowed to
           the game whose board was up; off, it opens on the whole library. */
        const preselect = settings.voiceInitialSearch === 'on' && mainView === 'game'
        setVoiceGameId(preselect ? selectedGameId : null)
        setMainView('voice')
        return
      }
      /* Penpot's "Ledger" board, likewise the app's rather than a game's. */
      if (action === 'ledger') {
        setMainView('ledger')
        return
      }
      /* The CSV export dialog stands over the whole window, the way Add Game
         does, rather than in the content column. */
      if (action === 'csv-export') {
        setShowCsv(true)
        return
      }
      /* The green circle is the blue one drawn from the pictures marked R18
         alone; what happens with the picture is the same from here on. */
      const pick = await window.library.randomGameImage(action === 'random-r18-image')
      if (!pick) {
        setExtraNotice({
          title: t(extraActionName(action)),
          message:
            action === 'random-r18-image'
              ? t('R18画像が1枚も登録されていません')
              : t('画像が1枚も登録されていません')
        })
        return
      }
      /* The ref is only for a game that is *changing*: the effect it is read
         by fires on the id alone, and a ref left set for the game already on
         would open the gallery the next time that game was picked. */
      if (pick.gameId !== selectedGameId) galleryOpenOn.current = pick.gameId
      setGalleryOpenImage(pick.imageId)
      // Not opened from a carousel, so CANCEL falls back to the thumbnail.
      setThumbOpenedFrom(null)
      setSelectedGameId(pick.gameId)
      setMainView('add-thumbnail')
    },
    [games, selectedGameId, mainView, closeExtra, settings.voiceInitialSearch]
  )
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
      current !== null && list.some((game) => game.id === current)
        ? current
        : firstListedGameId(list)
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

  async function refreshDuePlans(): Promise<void> {
    const today = toDateKey(new Date())
    const rows = await window.library.listPlans(today, today)
    setDueDay(today)
    setDuePlans(rows.filter((plan) => plan.notify))
  }

  /** Set once the initial selection has been restored, so the effect that
      persists the open game does nothing until then — a write before the
      restore is read would race the read to the same row. */
  const initDone = useRef(false)
  /** The last value written to `lastOpenGameId`, so an unchanged navigation is
      not written again. */
  const lastPersisted = useRef<string | null>(null)

  useEffect(() => {
    /* Games and settings are read together so the initial selection can be the
       game left open last time: restored when it still exists, and otherwise
       the first game the list shows. Done here rather than in `refreshGames`,
       which only ever keeps a valid selection. */
    void (async () => {
      const [list, loaded] = await Promise.all([
        window.library.listGames(),
        window.library.getSettings()
      ])
      setGames(list)
      setSettings(loaded)
      const remembered = Number(loaded.lastOpenGameId)
      const restore =
        loaded.lastOpenGameId !== '' && list.some((game) => game.id === remembered)
          ? remembered
          : firstListedGameId(list)
      setSelectedGameId(restore)
      initDone.current = true
    })()
    refreshGroups()
    refreshTags()
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

  /* **Remember the game whose board is open, for the next launch.** Written on
     every change of the open game or the board, so whatever it holds at close
     is the state the app was left in — a game board's own game, or empty when
     the board is not a game's (Home, Setting…), which is what falls the next
     launch back to the first listed game. Fire-and-forget: nothing reads it
     until the next launch, so the in-memory settings need not follow it. */
  useEffect(() => {
    if (!initDone.current) return
    const value = mainView === 'game' && selectedGameId !== null ? String(selectedGameId) : ''
    if (lastPersisted.current === value) return
    lastPersisted.current = value
    void window.library.setSettings({ lastOpenGameId: value })
  }, [mainView, selectedGameId])

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
    /* Unless the game was picked *for* its gallery — the Extra Function
       board's blue circle — in which case the gallery is the board asked for. */
    if (galleryOpenOn.current === selectedGameId) {
      galleryOpenOn.current = null
      setMainView('add-thumbnail')
      return
    }
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

  /* A total moved by hand is asked where the change should count: on the
     game alone, or on today as well — the footer's totals, the Calender board
     and the graph are sums over the sessions, and an offset on the game
     reaches none of them. Either way round: an addition is put on today and a
     subtraction taken off it, today being the one day a hand edit can be said
     to be about. */
  function handleEditPlayTime(gameId: number, seconds: number): void {
    const game = games.find((one) => one.id === gameId)
    if (game && seconds !== game.stats.totalPlaySeconds) {
      setPlayTimeEdit({ gameId, seconds, delta: seconds - game.stats.totalPlaySeconds })
      return
    }
    void writePlayTime(gameId, seconds, false)
  }

  async function writePlayTime(gameId: number, seconds: number, asPlayed: boolean): Promise<void> {
    await window.library.setTotalPlaySeconds(gameId, seconds, asPlayed)
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
    if (view === 'ledger') {
      return <Ledger games={games} language={settings.language} />
    }
    if (view === 'voice') {
      return (
        <VoiceManager
          games={games}
          initialGame={games.find((game) => game.id === voiceGameId) ?? null}
          initialVolume={settings.voiceVolume}
          onVolumeChange={async (voiceVolume) =>
            setSettings(await window.library.setSettings({ voiceVolume }))
          }
          onApplied={() => setMainView('game')}
          onCancel={() => setMainView('game')}
        />
      )
    }
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
          initialTag={homeInitialTag ?? undefined}
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
          openImageId={galleryOpenImage}
          openedFrom={thumbOpenedFrom}
          onCancel={(focusPath) => {
            setGalleryOpenImage(null)
            setCarouselFocus(focusPath)
            setMainView('game')
          }}
          onApplied={async (focusPath) => {
            setGalleryOpenImage(null)
            setCarouselFocus(focusPath)
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
        focusImage={carouselFocus}
        onLaunch={handleLaunch}
        onEditPlayTime={handleEditPlayTime}
        onOpenThumbnails={(fromImage) => {
          setThumbOpenedFrom(fromImage)
          setCarouselFocus(null)
          setMainView('add-thumbnail')
        }}
        onSetProgress={handleSetProgress}
        onCelebrate={(on) => {
          setCelebration(on ? 'ok' : null)
          setFinishing(false)
        }}
        onCelebrateRoute={() => {
          setCelebration('clear')
          setFinishing(false)
        }}
        /* What the Game board changes is play time as often as not — a session
           or an edit taken off the Play log — and the footer's totals are sums
           over the same rows, so they are read again with the library. */
        onGamesChanged={() => {
          void refreshGames()
          void refreshFooterStats()
        }}
        onSaveReference={handleSaveReference}
        onTagClick={(name) => {
          setHomeInitialTag(name)
          setMainView('home')
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
          groupFrame={settings.groupFrame}
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
            mainView === 'graph' ||
            mainView === 'voice' ||
            mainView === 'ledger'
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
          onHome={() => {
            // A plain HOME press opens the board unfiltered; the tag it may have
            // been opened with before does not linger.
            setHomeInitialTag(null)
            setMainView((current) => (current === 'home' ? 'game' : 'home'))
          }}
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
            /* The gallery is keyed on the picture it was opened on as well:
               the blue circle pressed while the gallery is already up is a
               new picture to open, and the board has to arrive again for it. */
            key={mainView === 'add-thumbnail' ? `${mainView}:${galleryOpenImage ?? ''}` : mainView}
          >
            {renderBoard(mainView)}
          </div>

          {/* The pages are turned over the Main Display alone, so they hang
              off the column rather than off the shell the way the finale
              does. */}
          {calendarFlip !== null && (
            <CalendarFlip key={calendarFlip} onDone={() => setCalendarFlip(null)} />
          )}

          {/* The Extra Function board stands in this column's own bottom-right
              corner, so it hangs off the column the way the pages do. */}
          {extra !== 'closed' && (
            <ExtraFunction
              closing={extra === 'closing'}
              onGone={() => setExtra('closed')}
              onDismiss={closeExtra}
              ignore={extraButtonRef}
              onAction={handleExtraAction}
            />
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
        extraOpen={extra === 'open'}
        onToggleExtra={toggleExtra}
        extraButtonRef={extraButtonRef}
        noteButtonRef={noteButtonRef}
      />

      {/* Shown once, on a fresh library: everything dims a little but the note
          icon, which a bobbing window and arrow point at. Dismissing it writes
          the flag, so it is not shown again. */}
      {settings.guideSeen === 'off' && (
        <FirstLaunchGuide
          noteRef={noteButtonRef}
          onDismiss={async () => setSettings(await window.library.setSettings({ guideSeen: 'on' }))}
        />
      )}

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
          addGameMore={settings.addGameMore === 'on'}
          language={settings.language}
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
          addGameMore={settings.addGameMore === 'on'}
          language={settings.language}
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

      {playTimeEdit !== null && (
        <ConfirmDialog
          title="play time"
          wide
          message={
            playTimeEdit.delta > 0
              ? t('追加した {0} を\n今日のプレイ時間としても記録しますか？', formatPlaytime(playTimeEdit.delta))
              : t('減らした {0} を\n今日のプレイ時間からも引きますか？', formatPlaytime(-playTimeEdit.delta))
          }
          note={t('反映すると、フッターの時間・カレンダー・プレイタイムグラフも変わります')}
          confirmLabel={t('はい')}
          cancelLabel={t('いいえ')}
          /* Walked away from — the backdrop, or Escape — the edit is dropped:
             nothing has been written yet, so the total stands where it was. */
          onDismiss={() => setPlayTimeEdit(null)}
          onCancel={() => {
            const edit = playTimeEdit
            setPlayTimeEdit(null)
            void writePlayTime(edit.gameId, edit.seconds, false)
          }}
          onConfirm={() => {
            const edit = playTimeEdit
            setPlayTimeEdit(null)
            void writePlayTime(edit.gameId, edit.seconds, true)
          }}
        />
      )}

      {extraNotice !== null && (
        <ConfirmDialog
          title={extraNotice.title}
          message={extraNotice.message}
          onConfirm={() => setExtraNotice(null)}
        />
      )}

      {showCsv && (
        <CsvExport
          games={games}
          groups={groups}
          tags={tags}
          onClose={() => setShowCsv(false)}
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
