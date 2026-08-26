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
  useRecorderPanel: boolean
  runAsAdmin: boolean
  keepSetting: boolean
}

export interface FooterStats {
  todaySeconds: number
  weekSeconds: number
  monthSeconds: number
}
