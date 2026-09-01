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
