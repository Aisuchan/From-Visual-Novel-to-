import type { GameWithStats, Tag } from '../../shared/db-types'

/**
 * What the Search Box, the Select Group field and the tag row come to. The
 * side panel and the Home board draw their own copies of all three, so the
 * rule for what they mean is shared rather than written twice.
 */
export interface GameFilter {
  /** Matched against the title and the short name. */
  query: string
  /** Matched against the game's own group name. */
  group: string
  /** One term per written chip; a game has to answer to every one of them. */
  tagTerms: string[]
}

/**
 * The two halves of the Select Group field, which are two different matches.
 *
 * **Finding a group** is a prefix: the menu narrows to the names beginning with
 * what has been typed, because typing at a list means starting to spell what is
 * on it — "s" means the groups beginning with s, and "as" is not one of them.
 *
 * **Filtering by one** is exact. The field is only read once it has been
 * settled — a row picked out of the menu, Enter, or the caret leaving it — so
 * what it holds by then is meant to be a group's whole name and not the start
 * of a search. Matched loosely, "A" quietly stood for AS and AAA as well, and
 * the list under it was three groups' games with nothing saying so. This is the
 * rule a tag already follows, and for the same reason.
 *
 * The Search Box is the third and matches what a title *contains*: a title is a
 * sentence, and the part of one that is remembered is rarely the first word.
 */
export function suggestsGroup(name: string, typed: string): boolean {
  const term = typed.trim().toLowerCase()
  return !term || name.trim().toLowerCase().startsWith(term)
}

export function matchesGroupName(name: string | null | undefined, chosen: string): boolean {
  const term = chosen.trim().toLowerCase()
  return !term || (name ?? '').trim().toLowerCase() === term
}

/**
 * What the Search Box, the Select Group field and the tag row come to over one
 * game list. Each of the three matches its own way; see `matchesGroupName`.
 */
export function filterGames(
  games: GameWithStats[],
  tags: Tag[],
  filter: GameFilter
): GameWithStats[] {
  const q = filter.query.trim().toLowerCase()
  const named = new Map(tags.map((tag) => [tag.id, tag.name.toLowerCase()]))
  const terms = filter.tagTerms.map((term) => term.trim().toLowerCase()).filter((t) => t !== '')

  return games.filter((game) => {
    const matchesQuery =
      !q ||
      game.title.toLowerCase().includes(q) ||
      (game.shortName ?? '').toLowerCase().includes(q)
    const matchesGroup = matchesGroupName(game.groupName, filter.group)
    const matchesTags = terms.every((term) =>
      game.tagIds.some((tagId) => named.get(tagId) === term)
    )
    return matchesQuery && matchesGroup && matchesTags
  })
}
