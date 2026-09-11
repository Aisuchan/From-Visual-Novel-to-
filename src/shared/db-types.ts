/**
 * What the Progress triangle reads. `null` leaves it to the play history: a
 * game with nothing on its log and no time on the clock is 'unplayed', anything
 * else is 'playing'. Clearing a game is always a deliberate act, so it is only
 * ever the stored value.
 */
export type ProgressState = 'unplayed' | 'playing' | 'cleared'

export interface Game {
  id: number
  title: string
  shortName: string | null
  thumbnailPath: string | null
  /* What the Home board's two faces draw. Null on either falls back to
     `thumbnailPath`, which is what both of them showed before a cell's own
     right-click menu could be given a picture. A picture set there belongs to
     that face alone: it never becomes the game's Main Image, never crosses to
     the other face, and never joins the Add Thumbnail gallery — which is the
     whole point of setting it from the cell rather than from the gallery. */
  homeCardImage: string | null
  homeSpineImage: string | null
  iconPath: string | null
  exePath: string
  groupName: string | null
  useExeIcon: boolean
  /** Fall back to `shortName` where the full title would not fit. */
  useShortName: boolean
  /** Reserved for the deferred ErogeScape/VNDB import. */
  useThumbnailAsDefault: boolean
  /** Set from the Progress triangle's menu; null means read it off the log. */
  progressState: ProgressState | null
  /** 0-100, shown in place of the cleared mark. Only ever set with 'cleared'. */
  clearScore: number | null
  /** YYYY-MM-DD, and ErogameScape's median and average for the game. The Add
      Game dialog's Reference row is what writes them; the Sort field's 発売日順
      and 中央値順 read the first two, and a game without one is filed below
      every game that has one. **Nothing reads the average yet** — it is stored
      the way the median was before 中央値順 existed. */
  releaseDate: string | null
  /** Which language's release that date is, where it was read off a page that
      lists one per language — the VN Database. Null for a date typed by hand or
      read off ErogameScape, which lists one; the Game Info board draws the mark
      beside the date only where there is one, so a date never stands for a
      release it is not. */
  releaseLanguage: VndbReleaseLanguage | null
  medianScore: number | null
  averageScore: number | null
  /** The studio the game is from, as ErogameScape names it. The Game Info
      board's BRAND row is what reads it. */
  brand: string | null
  /** The ErogameScape page this game's information was read from. The Game Info
      board's 🔞 opens it; with none, that mark is a gear instead and opens the
      dialog the information is set in. */
  referenceUrl: string | null
  /** The tags filed against this game (`game_tags`). Nothing writes them yet —
      the screen that would put a tag on a game is not built — but the side
      panel's tag row already reads them: a game that is not under every tag on
      that row is left out of the list. */
  tagIds: number[]
  /** When the game was marked cleared; null unless it is. */
  clearedAt: string | null
  /** What TOTAL PLAY stood at then, which the log's GAME CLEARD row reads. */
  clearPlaySeconds: number | null
  createdAt: string
}

/**
 * What the Game Info board holds, and what its own gear edits. Every field is
 * written as it stands — this is the board's four values being typed rather
 * than a page being read, so an emptied field is a value taken away.
 */
export interface GameReference {
  brand: string | null
  /** `YYYY-MM-DD`, the shape the release-date order is sorted on. */
  releaseDate: string | null
  medianScore: number | null
  averageScore: number | null
}

export interface NewGameInput {
  title: string
  shortName: string | null
  thumbnailPath: string | null
  iconPath: string | null
  exePath: string
  groupName: string | null
  /* The names on the dialog's Tag row. They are resolved against the one
     vocabulary the library shares — a name already in `tags` is reused, a new
     one puts out a row — and what comes back is the game's `tagIds`. */
  tagNames: string[]
  useExeIcon: boolean
  useShortName: boolean
  useThumbnailAsDefault: boolean
  /* What the Reference row read off ErogameScape, where it was used. Null on
     every field the row was not pressed for, which is what leaves a game
     registered by hand exactly as it always was. */
  releaseDate?: string | null
  /** Which release the date above is, where the row read it off the VN
      Database; see `Game.releaseLanguage`. */
  releaseLanguage?: VndbReleaseLanguage | null
  medianScore?: number | null
  averageScore?: number | null
  brand?: string | null
  /* The Reference row's own field rather than something it read, so this one is
     written as it stands — cleared where the field was emptied. */
  referenceUrl?: string | null
}

/**
 * One picture registered against a game, shown in the Add Thumbnail grid.
 * `source` distinguishes files the user added by hand from Recorder Panel
 * screenshots — auto-importing those is a deferred setting, so nothing writes
 * 'screenshot' yet.
 */
export interface GameImage {
  id: number
  gameId: number
  filePath: string
  /**
   * Where the picture came from, if it came from anywhere: the file that was
   * picked out of the dialog, or the place a screenshot was saved to. The app
   * keeps a copy of its own under `userData` — which is what `filePath` is and
   * what the gallery draws — so this is the only record of the original, and
   * 「ファイルの場所を開く」 is what reads it: the file a player means is the
   * one they have, and the app's copy stands in only once that one is gone.
   * Null for a row that never had an original of its own.
   */
  sourcePath: string | null
  source: 'manual' | 'screenshot' | 'recording'
  createdAt: string
}

/**
 * A route through a game. Every game has at least the common line it opens on
 * (created on the first read of its list), and exactly one route is active at a
 * time — the one a finished session's play time is banked on.
 */
export interface Route {
  id: number
  gameId: number
  name: string
  /** #rrggbb; what the name is set in wherever the route is shown. */
  color: string
  playSeconds: number
  cleared: boolean
  /** When the route was marked cleared, and what it had on the clock then —
      the Play log's `♡ CLEARED "..."  in  hh : mm` row. Both null until it is. */
  clearedAt: string | null
  clearPlaySeconds: number | null
  isActive: boolean
  createdAt: string
}

export interface NewRouteInput {
  gameId: number
  name: string
  color: string
  playSeconds: number
  cleared: boolean
}

export type RoutePatch = Omit<NewRouteInput, 'gameId'>

/**
 * A group a game can be filed under. Games carry the group's *name* in
 * `Game.groupName` — the field was free text before groups were a thing, and
 * still is — so this table is the list the Select Group menu offers and the
 * place a group's colour lives.
 */
export interface Group {
  id: number
  name: string
  /** #rrggbb; what the name is set in wherever the group is listed. */
  color: string
  createdAt: string
}

export interface NewGroupInput {
  name: string
  color: string
}

/**
 * A tag, as the side panel's Add Tag row makes them. A tag is created blank and
 * named in place, so a row can stand with an empty name for as long as one is
 * being typed; leaving it empty is what removes it.
 */
export interface Tag {
  id: number
  name: string
  createdAt: string
}

export interface GameStats {
  totalPlaySeconds: number
  lastPlayedAt: string | null
  /** Whether the Play log has a GAME START on it, i.e. the game was launched. */
  hasSessions: boolean
}

export interface GameWithStats extends Game {
  stats: GameStats
}

export interface Session {
  id: number
  gameId: number
  startedAt: string
  endedAt: string | null
  durationSeconds: number
  recorded: boolean
}

/** One local day's recorded play time — what the Calender board's cells carry
    while "Show Playtime" is on. `date` is a local "YYYY-MM-DD", and a day with
    no play time at all is simply absent from the list. */
export interface DayPlaytime {
  date: string
  seconds: number
}

/** A plan on the Calender board — one entry on a day of the schedule. */
export interface Plan {
  id: number
  /** The local day it falls on, written as "YYYY-MM-DD". */
  date: string
  name: string
  /** Penpot: "PLAN DESCRIPTION" — the line under the name; may be empty. */
  description: string
  /** #rrggbb; the plate the plan is drawn on, in the cell's chip and in the
      Plan panel's own list. */
  color: string
  /** Penpot's own Notification switch. Stored; nothing raises a notification
      yet, the way `language` is stored and nothing reads it. */
  notify: boolean
}

export type NewPlanInput = Omit<Plan, 'id'>

/** What one game was played for on one local day. The PlayTime Graph board's
    whole source: its pie and its game list add these up per game, its histogram
    per day, and its bars are the rows themselves. */
export interface DayGamePlaytime {
  /** The local day, "YYYY-MM-DD". */
  date: string
  gameId: number
  seconds: number
}

export interface LaunchPrefs {
  gameId: number | null
  recordTime: boolean
  useRecorderPanel: boolean
  runAsAdmin: boolean
  /** Never persisted: it asks for the other three to be kept, then clears. */
  keepSetting: boolean
}

export interface FooterStats {
  todaySeconds: number
  weekSeconds: number
  monthSeconds: number
}

/* The Setting board's 言語/language row. The app is written in Japanese and
   the design in English; this is what will say which of the two the interface
   is set in once there is a vocabulary to swap. Until then it is stored and
   read back and nothing else reads it. */
export type Language = 'ja' | 'en'

/* The three format rows. Each of them names the file the Recorder Panel's own
   button writes, so the choice is read where that file is opened rather than
   only stored: the screenshot's encoder, the recording's extension, and which
   of the two encoders the audio tap runs through. */
export type ScreenshotFormat = 'png' | 'jpg'
export type VideoFormat = 'mp4' | 'mov'
export type AudioFormat = 'mp3' | 'wav'

/* The Setting board's 起動時のウインドウサイズ row: whether the library window
   opens at its own 1280x720 or fills the screen. The 16:9 ratio is held either
   way — a work area is 16:9 whenever the display is. */
export type LaunchWindowMode = 'window' | 'fullscreen'

/*
 * **The Setting board's 描画方式 row: how much of the drawing the GPU does.**
 *
 * It is not a preference about speed. On some machines — measured on one with
 * two 1920x1080 displays both at 100%, so no scaling of any kind in play, and an
 * NVIDIA driver — every window Chromium presents comes out *soft*, text
 * included, and the same is true of other apps built the same way. Nothing about
 * the page causes it: what is resampled is the surface the compositor presents
 * through, which is the driver's side of DirectComposition. Turning the GPU off
 * answers it and gives up more than it has to, so the row is the *ladder* rather
 * than a switch — each rung hands one more stage to the CPU:
 *
 *   auto                   — Chromium's own defaults
 *   no-direct-composition  — presented without DirectComposition or overlays
 *   no-gpu-compositing     — the final compositing on the CPU; raster and video
 *                            decode still on the GPU
 *   off                    — hardware acceleration off entirely
 *
 * A capture is unaffected by any of them: a screenshot is a `desktopCapturer`
 * thumbnail and a recording is MediaRecorder's, neither of which goes through
 * the compositor this row is about.
 *
 * The switches have to be set before the app is ready, so this is the one row
 * read outside a window's lifetime — and the only one a change to has no effect
 * until the app is started again, which its description says.
 */
export const GPU_MODES = ['auto', 'no-direct-composition', 'no-gpu-compositing', 'off'] as const
export type GpuMode = (typeof GPU_MODES)[number]

/**
 * Which language's release the VN Database's date is read off.
 *
 * A visual novel is released more than once — the original, and a translation
 * for every market that gets one — and VNDB lists them in a block per language.
 * Which of those blocks is *the* release date is the player's question rather
 * than the site's: a library kept in Japanese usually means the original, and
 * one kept off the English releases means the day it could be played. So the
 * row picks the block, and the first complete release in it is what is read.
 *
 * The page's own labels are what these stand for — "English", "Chinese",
 * "Japanese" — and Chinese is matched by its head, the site writing traditional
 * and simplified as two labels beginning with that word.
 */
export const VNDB_RELEASE_LANGUAGES = ['en', 'zh', 'ja'] as const
export type VndbReleaseLanguage = (typeof VNDB_RELEASE_LANGUAGES)[number]

/* Which of the Home board's two faces it opens on — the design's Container, a
   grid of cards, or its Bookshelf Container, a shelf of spines. Not a row on
   the Setting board: it is what the board's own toggle was last left on, kept
   so that opening Home again finds it where it was left. */
export type HomeLayout = 'grid' | 'shelf'

/* How large the Recorder Panel is drawn. 中 is the design's own 227x30 and the
   other two are a quarter either side of it — the panel sits over a game and
   how big it wants to be there is the player's, not the design's. The page is
   still laid out in the design's own figures and scaled as a whole, the way the
   library window is; the main process scales the window and the region it is
   clipped to by the same factor. */
export const OVERLAY_SIZES = ['large', 'medium', 'small'] as const
export type OverlaySize = (typeof OVERLAY_SIZES)[number]
export const OVERLAY_SCALES: Record<OverlaySize, number> = {
  large: 1.25,
  medium: 1,
  small: 0.75
}

/* How many cards the grid puts on a row. The design draws five; pressing the
   thumbnail button while it is already the one that is on steps through these,
   so the same control asks for the face and then for the size of it. Kept
   beside `homeLayout` and for the same reason — the board is remounted every
   time it is opened, so a size chosen here is one the next open finds. Written
   as text because that is what the settings table holds. */
export const HOME_COLUMNS = ['4', '5', '6'] as const
export type HomeColumns = (typeof HOME_COLUMNS)[number]

/* The same for the shelf, whose button does the same thing: the design's 25
   spines across, and a step either side of it. */
export const HOME_SPINES = ['20', '25', '30'] as const
export type HomeSpines = (typeof HOME_SPINES)[number]

/* Which of Penpot's "Setting Period" rows the PlayTime Graph opens on. Not a
   row on the Setting board either: it is what that board's own SET DEFAULT was
   last pressed on, kept so the graph opens on the period its owner reads. */
export const GRAPH_PERIODS = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'this-month',
  'last-month',
  'this-quarter',
  'last-quarter',
  'this-half',
  'last-half',
  'this-year',
  'last-year'
] as const
export type GraphPeriod = (typeof GRAPH_PERIODS)[number]

/* A setting that is on or off — the design's own On / Off Button, which it
   draws as a placeholder and which these are the first real rows to use.
   Stored as the word rather than as 0/1: the settings table is one flat
   key/value list of strings, and `oneOf` is what validates every other row. */
export type Toggle = 'on' | 'off'

/* Which corner the Recorder Panel opens in. It is the panel's *initial*
   position — the Move Button still drags it anywhere once it is up — and the
   two left corners also turn the panel around, so its controls run from the
   corner it is in rather than always from the left. */
export const OVERLAY_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export type OverlayCorner = (typeof OVERLAY_CORNERS)[number]

/**
 * One of the Recorder Panel's effect sounds, read off `recorderpanel_SE`.
 * `key` is the number the file's name begins with, which is what the Setting
 * board offers and what is stored; `file` is the name itself.
 */
export interface SoundEffect {
  key: string
  file: string
}

/** One of the desktop's displays, as the Setting board's own row lists them. */
export interface ScreenDisplay {
  /** Electron's own display id, in decimal — what `overlayDisplay` stores. */
  id: string
  /** What a row of the list says: the number, the resolution and whether it is
      the main one — everything a player can check against what is in front of
      them. */
  label: string
  /** What the field itself says once one is picked. The box is 117 wide for a
      41px run, so the whole of the above would be stepped down to nothing there;
      what the resolution is for is telling two monitors apart while they are
      side by side in the list, which is over once one has been chosen. */
  short: string
  primary: boolean
}

/** The app's own settings, read and written as a whole. */
export interface AppSettings {
  language: Language
  /** Which language's release the Add Game dialog reads a date off; see
      `VNDB_RELEASE_LANGUAGES`. */
  vndbReleaseLanguage: VndbReleaseLanguage
  screenshotFormat: ScreenshotFormat
  videoFormat: VideoFormat
  audioFormat: AudioFormat
  homeLayout: HomeLayout
  homeColumns: HomeColumns
  homeSpines: HomeSpines
  /* The day the footer's Notification board was last confirmed on, written as
     the same local "YYYY-MM-DD" a plan carries — or empty for none. The row
     stands for today's plans, so a confirmation is about a day: it takes the
     mark off that day and the next day's plans put it back without anything
     having to clear it. */
  noticeSeen: string
  graphPeriod: GraphPeriod
  overlayCorner: OverlayCorner
  /* Which display the panel opens on: an Electron display id, or 'primary'
     for whichever display is the primary one at the time. A display that is
     no longer there falls back to the primary rather than opening the panel
     off the desktop. */
  overlayDisplay: string
  /* Whether the app's own arrivals run. Off, every one of them is taken to
     nothing — the boards, the pages the Calender board is turned to through,
     the ring, the bars and the Recorder Panel's own fold — so a screen is
     simply there rather than arriving. */
  animations: Toggle
  /* Whether a shot taken from the Recorder Panel is also filed in the game's
     own Add Thumbnail gallery, which is what `game_images.source` has always
     told apart. */
  screenshotToGallery: Toggle
  /* The same for a screen recording, which the gallery can hold now that it
     holds clips. Its own row rather than the shot's: a folder of recordings is
     a different thing from a folder of stills, and a player who wants one
     filed does not necessarily want the other. */
  videoToGallery: Toggle
  /** How large the Recorder Panel is drawn — the design's own size, and a
      quarter either side of it. */
  overlaySize: OverlaySize
  /* The 音声 tab: the two sounds the finale makes. Both are already played
     and this is only whether they are — the confetti's crackers as the clip's
     own cues come up, and a balloon's pop as it is clicked. */
  crackerSound: Toggle
  balloonSound: Toggle
  /* Which of `recorderpanel_SE`'s sounds the panel's buttons make, by the
     number its file is named for — or `off`, which is what both open on: the
     panel has never made a sound, and a shutter nobody asked for is a sound
     over a game. A number no file answers to any more plays nothing. */
  screenshotSound: string
  /* One row each, rather than the single 録画・録音 row these two began as: a
     shutter and a stop are different events and the files that suit them are
     different files. An install made before the split carries its old choice
     into both. */
  videoSound: string
  audioSound: string
  /* Whether Windows starts the app when the machine does. It is the one row
     that is not the app's own state: what it writes is the system's Run key,
     through `app.setLoginItemSettings`, so the row and the machine are kept in
     step rather than the row standing for something nothing acts on. */
  launchAtLogin: Toggle
  /* 一般: how the library window opens, and whether the database is copied
     somewhere as it does. `backupDirectory` is a folder the player names — an
     empty one is what an unanswered row is, and nothing is copied then. */
  launchWindowMode: LaunchWindowMode
  /** How much of the drawing the GPU does; see `GPU_MODES`. */
  gpuMode: GpuMode
  backupOnLaunch: Toggle
  backupDirectory: string
  /* What a backup is read back *from*. It is a row on the board rather than a
     dialog because the row is where the path is written; the 読み込み button
     beside it is what acts on it. */
  backupRestorePath: string
  /* Where each kind of capture was last saved, so the next save dialog opens
     on it. Not rows on the board — they are what the dialog was last answered
     with, the way `homeLayout` is what the Home board was last left on. */
  lastSaveScreenshot: string
  lastSaveVideo: string
  lastSaveAudio: string
}
