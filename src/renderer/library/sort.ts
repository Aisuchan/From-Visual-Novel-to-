import type { GameWithStats } from '../../shared/db-types'

/** What the side panel's Sort field orders the game list by. */
export type SortKey =
  | 'last-played'
  | 'added'
  | 'manual'
  | 'kana'
  | 'release'
  | 'playtime'
  | 'score'
  | 'median'

/** The order the list opens on. */
export const DEFAULT_SORT: SortKey = 'last-played'

/** The one order the drag handle can write, so the only one it stands under. */
export const MANUAL_SORT: SortKey = 'manual'

/* The Sort menu's rows, in the order they are offered. Dates run newest first
   and figures largest first — "プレイ順" is the newest play, not the oldest —
   while the ones that read as a sequence, the registration order and the
   syllabary, run forwards. */
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'last-played', label: 'プレイ順' },
  { key: 'added', label: '追加順' },
  { key: 'manual', label: '手動並び順' },
  { key: 'kana', label: '50音順' },
  { key: 'release', label: '発売日順' },
  { key: 'playtime', label: 'プレイ時間順' },
  { key: 'score', label: 'つけた点数順' },
  { key: 'median', label: '中央値順' }
]

export function sortLabel(key: SortKey): string {
  return SORTS.find((sort) => sort.key === key)?.label ?? ''
}

/** The name the list writes for a game, which is also the name it sorts by. */
export function displayName(game: GameWithStats): string {
  return game.useShortName && game.shortName ? game.shortName : game.title
}

/* 50音順 is asked for as 数字 → 日本語 → 英語(その他), so the first character
   puts a title in one of three groups before anything is compared inside one.
   Kana are ordered properly by the collator below; a kanji has no reading
   stored against it, so it falls where the collator puts the character
   itself. */
const DIGIT = /[0-9０-９]/
const JAPANESE = /[々぀-ヿㇰ-ㇿ㐀-䶿一-鿿ｦ-ﾟ]/

function kanaBucket(name: string): number {
  const first = name.trim().charAt(0)
  if (!first) return 3
  if (DIGIT.test(first)) return 0
  if (JAPANESE.test(first)) return 1
  return 2
}

const COLLATOR = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

/** Largest first, and anything without a figure of its own below all of them. */
function byNumberDesc(a: number | null, b: number | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return b - a
}

/** The same for the datetime strings the database keeps, which sort as text. */
function byDateDesc(a: string | null, b: string | null): number {
  if (!a || !b) return a === b ? 0 : !a ? 1 : -1
  return a < b ? 1 : a > b ? -1 : 0
}

/**
 * Orders a copy of the list. `sort` is stable, so games that tie keep the order
 * they arrived in — which is the list's own stored order, `sort_order`. That
 * stored order is "手動並び順" itself: it starts as the order the games were
 * registered in and only the drag handle ever changes it, which is why the
 * handle stands under that order and nowhere else. "追加順" is the registration
 * order proper, read off the ids, so dragging never moves it.
 */
export function sortGames(games: GameWithStats[], key: SortKey): GameWithStats[] {
  if (key === 'manual') return games

  const list = [...games]
  switch (key) {
    case 'added':
      return list.sort((a, b) => a.id - b.id)
    case 'last-played':
      return list.sort((a, b) => byDateDesc(a.stats.lastPlayedAt, b.stats.lastPlayedAt))
    case 'kana':
      return list.sort((a, b) => {
        const nameA = displayName(a)
        const nameB = displayName(b)
        const bucket = kanaBucket(nameA) - kanaBucket(nameB)
        return bucket !== 0 ? bucket : COLLATOR.compare(nameA, nameB)
      })
    case 'release':
      return list.sort((a, b) => byDateDesc(a.releaseDate, b.releaseDate))
    case 'playtime':
      return list.sort((a, b) => b.stats.totalPlaySeconds - a.stats.totalPlaySeconds)
    case 'score':
      return list.sort((a, b) => byNumberDesc(a.clearScore, b.clearScore))
    case 'median':
      return list.sort((a, b) => byNumberDesc(a.medianScore, b.medianScore))
  }
}
