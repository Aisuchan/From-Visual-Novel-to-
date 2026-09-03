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
  /** YYYY-MM-DD, and ErogeScape's median for the game. Both come from the
      deferred ErogeScape/VNDB import, so nothing writes them yet — the Sort
      field's 発売日順 and 中央値順 read them, and a game without one is filed
      below every game that has one. */
  releaseDate: string | null
  medianScore: number | null
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
  source: 'manual' | 'screenshot'
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

/* Which of the Home board's two faces it opens on — the design's Container, a
   grid of cards, or its Bookshelf Container, a shelf of spines. Not a row on
   the Setting board: it is what the board's own toggle was last left on, kept
   so that opening Home again finds it where it was left. */
export type HomeLayout = 'grid' | 'shelf'

/** The app's own settings, read and written as a whole. */
export interface AppSettings {
  language: Language
  screenshotFormat: ScreenshotFormat
  videoFormat: VideoFormat
  audioFormat: AudioFormat
  homeLayout: HomeLayout
}
