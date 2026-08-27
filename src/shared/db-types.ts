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

export interface GameStats {
  totalPlaySeconds: number
  lastPlayedAt: string | null
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
