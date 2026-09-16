import type { GameWithStats } from '../../shared/db-types'
import { t } from '../../shared/i18n'

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

/** Which way an order runs. */
export type SortDirection = 'asc' | 'desc'

/* Every order but the syllabary can be turned round. 50音順 is 数字 → 日本語 →
   英語(その他) by design — three groups in a sequence of their own rather than
   one run of values — so a direction on it would say nothing about the groups
   and only half of what it says inside them. The Reverse Order Button beside
   each Sort field is off on it. */
export function hasDirection(key: SortKey): boolean {
  return key !== 'kana'
}

/* The way each order stands when it is picked, which is the way it has always
   run: dates newest first and figures largest first, while the ones that read
   as a sequence — the registration order and the list's own stored one — run
   forwards. Picking an order is asking for it by the name it is offered under,
   so this is the direction a pick lands on; the Reverse Order Button beside the
   field is what turns it round. */
export const DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
  'last-played': 'desc',
  added: 'asc',
  manual: 'asc',
  kana: 'asc',
  release: 'desc',
  playtime: 'desc',
  score: 'desc',
  median: 'desc'
}

/** What a direction is called where there is room for the word: a tooltip. */
export function directionLabel(direction: SortDirection): string {
  return t(direction === 'asc' ? '昇順' : '降順')
}

/* The Sort menu's rows, in the order they are offered. Dates run newest first
   and figures largest first — "プレイ順" is the newest play, not the oldest —
   while the ones that read as a sequence, the registration order and the
   syllabary, run forwards. */
/* **These are keys, not runs.** The list is built as the module is imported,
   which is before the shell has read the 言語/language row, so a name
   translated here would be frozen in whatever the language was at load. Every
   one of them goes through `t` where it is *read* instead — `sortLabel`
   below. */
/* i18n-keys: the runs below are keys, read through `t` where drawn. */
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
  const label = SORTS.find((sort) => sort.key === key)?.label
  return label ? t(label) : ''
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

/* Largest first or smallest first, and **anything without a figure of its own
   below all of them either way**: a game that has never been played has no
   place at the top of 昇順, the way a game with no score is not a low score. */
function byNumber(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return direction === 'desc' ? b - a : a - b
}

/** The same for the datetime strings the database keeps, which sort as text. */
function byDate(a: string | null, b: string | null, direction: SortDirection): number {
  if (!a || !b) return a === b ? 0 : !a ? 1 : -1
  if (a === b) return 0
  return (a < b ? 1 : -1) * (direction === 'desc' ? 1 : -1)
}

/**
 * Orders a copy of the list. `sort` is stable, so games that tie keep the order
 * they arrived in — which is the list's own stored order, `sort_order`. That
 * stored order is "手動並び順" itself: it starts as the order the games were
 * registered in and only the drag handle ever changes it, which is why the
 * handle stands under that order and nowhere else. "追加順" is the registration
 * order proper, read off the ids, so dragging never moves it.
 *
 * `direction` turns any of them round but 50音順, which has none. It is not
 * set apart from the order: the menu offers each order twice, so picking a row
 * is picking the pair.
 */
export function sortGames(
  games: GameWithStats[],
  key: SortKey,
  direction: SortDirection = DEFAULT_DIRECTION[key]
): GameWithStats[] {
  /* The stored order turned round is the whole of 手動並び順 descending; there
     are no ties in it to keep, every game having a slot of its own. */
  if (key === 'manual') return direction === 'desc' ? [...games].reverse() : games

  const list = [...games]
  switch (key) {
    case 'added':
      return list.sort((a, b) => (direction === 'desc' ? b.id - a.id : a.id - b.id))
    case 'last-played':
      return list.sort((a, b) => byDate(a.stats.lastPlayedAt, b.stats.lastPlayedAt, direction))
    case 'kana':
      return list.sort((a, b) => {
        const nameA = displayName(a)
        const nameB = displayName(b)
        const bucket = kanaBucket(nameA) - kanaBucket(nameB)
        return bucket !== 0 ? bucket : COLLATOR.compare(nameA, nameB)
      })
    case 'release':
      return list.sort((a, b) => byDate(a.releaseDate, b.releaseDate, direction))
    case 'playtime':
      return list.sort((a, b) =>
        byNumber(a.stats.totalPlaySeconds, b.stats.totalPlaySeconds, direction)
      )
    case 'score':
      return list.sort((a, b) => byNumber(a.clearScore, b.clearScore, direction))
    case 'median':
      return list.sort((a, b) => byNumber(a.medianScore, b.medianScore, direction))
  }
}
