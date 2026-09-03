import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GameWithStats, Group, HomeLayout, Tag } from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import { useContextMenuDismiss } from '../context-menu'
import { filterGames, suggestsGroup } from '../filter'
import { DEFAULT_SORT, displayName, sortGames, sortLabel, SORTS, type SortKey } from '../sort'
import ContextMenu from './ContextMenu'
import GameHover from './GameHover'
import OptionMenu from './OptionMenu'
import TagChip from './TagChip'
import './Home.css'

/*
 * Penpot: Home — the library's own board, in the Main Display slot the Game
 * board occupies. It is reached from the side panel's HOME button.
 *
 * The four controls the design draws across its Top — SORT, GROUP, SEARCH...
 * and the tag row — are the side panel's own four over the same library, and
 * they mean exactly what they mean there: the rule for what the three filters
 * come to is shared (`filter.ts`) and so is the list of orders (`sort.ts`).
 * What they are *not* is shared state: the two screens carry their own, so
 * narrowing the grid never reorders the panel beside it.
 */

/** Penpot: Home — the board's own width, which a menu's scale comes off. */
const BOARD_WIDTH = 1585
/** Penpot: Way to Sort — 239 wide, which the menu under it takes too. */
const SORT_WIDTH = 239
/** Penpot: Group Select — 331. */
const GROUP_WIDTH = 331
/** Penpot: "SORT" / "GROUP" — Girassol 35px in a field with 30px either side. */
const FIELD_FONT_SIZE = 35
/** The add row and the five groups the design's own Menu board draws. */
const GROUP_MENU_ROWS = 6
/** The key the "everything" row answers to, which is no group's id. */
const ALL_GROUPS_KEY = 'all-groups'

/* Penpot: Game Hover — 346x255 at the three fifths the board is drawn here,
   and the air the pointer keeps in front of it. */
const HOVER_WIDTH = 346 * 0.6
const HOVER_HEIGHT = 255 * 0.6
const HOVER_GAP = 16
/** Penpot draws a menu flush under its row; a little air reads better. */
const MENU_GAP = 6
/** How long a cell takes to grow, kept in step with `Home.css`. */
const GROW_MS = 150

/* Penpot draws two rows of five. The cards arrive on a diagonal from the top
   left rather than all at once — a card waits by the column it is in plus the
   row it is on, so the wave runs down and across together. Held to a ceiling
   so a long library's last row is not still arriving after the first is
   settled. */
const GRID_COLUMNS = 5
const ARRIVE_STEP_MS = 45
const ARRIVE_MAX_MS = 600

/* The shelf fills the way a shelf is filled: one book at a time from the left
   of the top row, each tipped upright into the row rather than fading in
   where it stands. Straight index order — the diagonal the cards arrive on
   would read as a sweep across 25 columns — and a step short enough that a
   whole row of 25 is put away in a third of a second. */
const SHELVE_STEP_MS = 14
const SHELVE_MAX_MS = 500

/* A cell's own right-click menu, which offers the face it was opened on and
   nothing else. A picture given to a cell is cropped to that cell's frame —
   the card, which is Penpot's 253x304 Thumbnail taken to the 5:6 beside it, or
   the spine, which is its own height over six — so the menu says which shape
   it will be cut to rather than leaving it to be found out by trying. The two
   faces are named as their own buttons name them, above the grid. */
const FACE_NAME: Record<HomeLayout, string> = { grid: 'サムネイル画像', shelf: '背表紙画像' }
const FACE_RATIO: Record<HomeLayout, string> = { grid: '5 : 6', shelf: '1 : 6' }

interface Props {
  games: GameWithStats[]
  /** The groups the GROUP menu offers. */
  groups: Group[]
  /** The tag vocabulary the chips are matched against. */
  tags: Tag[]
  /** Opens the game's own board, the way picking it in the side panel does. */
  onSelect: (gameId: number) => void
  /** Read the library again — a cell has just been given its own picture. */
  onGamesChanged: () => void | Promise<void>
  /* Which face the board is on. It is the app's rather than this component's,
     the board being remounted every time it is opened — a face chosen here is
     one the next open finds. */
  layout: HomeLayout
  onLayoutChange: (layout: HomeLayout) => void
}

export default function Home({
  games,
  groups,
  tags,
  onSelect,
  onGamesChanged,
  layout,
  onLayoutChange
}: Props): React.JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const sortRef = useRef<HTMLButtonElement | null>(null)
  const groupRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const tagsRef = useRef<HTMLDivElement | null>(null)

  const [query, setQuery] = useState('')
  /* The Group field is two things. `groupText` is what is in it, which is what
     the suggestions are drawn from; `groupName` is the group the grid is
     actually narrowed to, and it only moves when the field is **settled** —
     a row picked out of the menu, Enter, or the caret leaving the field.
     Filtering on every keystroke instead meant a name was typed through a run
     of lists nobody asked for: with the match starting at a name's first
     letter, "T" already stood for TEST and everything else was gone. The one
     exception is a field emptied out, which is settled as it happens — there
     is nothing left to finish typing, and a filter still on under an empty
     field reads as a bug. */
  const [groupText, setGroupText] = useState('')
  /** The group's own name, which is what a game carries; '' is every group. */
  const [groupName, setGroupName] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT)
  /* The chips ADD TAG + puts out. They are a filter over the grid and nothing
     more — a chip is a piece of text, and taking one off never touches a tag
     on a game. `newTagId` is the chip that has just appeared, which takes the
     caret. */
  const [tagFilters, setTagFilters] = useState<{ id: number; text: string }[]>([])
  const [newTagId, setNewTagId] = useState<number | null>(null)
  const nextTagId = useRef(1)
  /* Which of Penpot's "Menu" boards is out, at most one at a time. 'group' is
     the whole list, dropped out of the row by its ▼; 'group-suggest' is the
     same board narrowed to what has been typed into the field, which is what
     the side panel's own Select Group does. */
  const [menu, setMenu] = useState<{
    key: 'sort' | 'group' | 'group-suggest'
    top: number
    left: number
  } | null>(null)
  /* The cells that are drawn grown. Not simply the one under the pointer: a
     card the pointer only passes over would start growing and be pulled back
     before it had gone anywhere, so a cell is held until it has had its full
     `GROW_MS` and only then let go. The sequence always runs, and the time
     spent at full size is whatever is left of that and no more. */
  const [grown, setGrown] = useState<number[]>([])
  const grownAt = useRef(new Map<number, number>())
  const releases = useRef(new Map<number, number>())
  /** The cell the pointer is actually over, which is what `release` follows. */
  const over = useRef<number | null>(null)

  /* The cell a right-click landed on, and where on the board the plate hangs.
     Design pixels off the board, the same space the hover and the two field
     menus are placed in. */
  const [cardMenu, setCardMenu] = useState<{
    gameId: number
    left: number
    top: number
  } | null>(null)

  /* The card the pointer is on, which puts its Game Hover up, and
     where that panel goes — the pointer's lower right, worked out as the
     pointer moves rather than written on the card, so the panel follows it.
     Design pixels off the board, which is what the panel hangs in. */
  const [hover, setHover] = useState<{ id: number; left: number; top: number } | null>(null)

  function grow(id: number): void {
    const pending = releases.current.get(id)
    if (pending !== undefined) {
      clearTimeout(pending)
      releases.current.delete(id)
    }
    if (grownAt.current.has(id)) return
    grownAt.current.set(id, performance.now())
    setGrown((list) => (list.includes(id) ? list : [...list, id]))
  }

  function release(id: number): void {
    const since = grownAt.current.get(id)
    if (since === undefined || releases.current.has(id)) return
    const drop = (): void => {
      releases.current.delete(id)
      grownAt.current.delete(id)
      setGrown((list) => list.filter((one) => one !== id))
    }
    const left = GROW_MS - (performance.now() - since)
    if (left <= 0) drop()
    else releases.current.set(id, window.setTimeout(drop, left))
  }

  /** Whatever is still on its way back when the board goes. */
  useEffect(() => {
    const pending = releases.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  /* `position: fixed` and `getBoundingClientRect` do not share the shell's
     coordinate space, so a client point is converted by the board's own known
     width — the same conversion the menus below make. The panel keeps to the
     pointer's lower right until there is no room for it: past the board's right
     edge it goes to the left of the pointer instead, and past the bottom it is
     held inside rather than turned over, which keeps it under the pointer. */
  function trackHover(event: React.MouseEvent<HTMLDivElement>): void {
    const board = boardRef.current
    if (!board) return
    /* Which cell the pointer is over is asked of the pointer rather than
       remembered per card: one listener on the whole face, and the cell is
       whatever the event came out of. */
    const cell = (event.target as HTMLElement).closest('[data-game-id]')
    if (!cell) {
      leaveFace()
      return
    }
    const id = Number(cell.getAttribute('data-game-id'))
    if (over.current !== id) {
      if (over.current !== null) release(over.current)
      over.current = id
      grow(id)
    }
    const rect = board.getBoundingClientRect()
    const scale = rect.width / BOARD_WIDTH
    const x = (event.clientX - rect.left) / scale
    const y = (event.clientY - rect.top) / scale
    const height = rect.height / scale
    let left = x + HOVER_GAP
    if (left + HOVER_WIDTH > BOARD_WIDTH) left = x - HOVER_GAP - HOVER_WIDTH
    const top = Math.min(y + HOVER_GAP, height - HOVER_HEIGHT)
    setHover({ id, left, top })
  }

  /* Penpot draws no menu on a cell; this is the app's own, and it is the same
     plate the side panel's rows put up. It is opened on the cell the press
     came out of, worked out from the pointer the way the hover is. */
  function openCardMenu(event: React.MouseEvent<HTMLDivElement>): void {
    const board = boardRef.current
    if (!board) return
    const cell = (event.target as HTMLElement).closest('[data-game-id]')
    if (!cell) return
    event.preventDefault()
    /* The cell, not the face the handler is on: right-clicking a *different*
       cell has to close this plate and open that one, and only a press back on
       this same cell is the toggle. */
    cardOpener.current = cell as HTMLElement
    const rect = board.getBoundingClientRect()
    const scale = rect.width / BOARD_WIDTH
    // The panel says where the pointer is and the pointer has stopped; the
    // plate would stand over it in any case.
    setHover(null)
    setCardMenu({
      gameId: Number(cell.getAttribute('data-game-id')),
      left: (event.clientX - rect.left) / scale,
      top: (event.clientY - rect.top) / scale
    })
  }

  /* A picture for one face of one cell. It is picked, copied and written in the
     one call, and what comes back is the game as it now stands — nothing else
     in the app reads these two columns, so the card changes and the Game
     board's Main Image, the gallery and the other face do not. */
  async function pickFaceImage(gameId: number, face: HomeLayout): Promise<void> {
    setCardMenu(null)
    const updated = await window.library.pickHomeImage(gameId, face)
    // Nothing to read again if the dialog was closed.
    if (updated) await onGamesChanged()
  }

  /** Hands the face back to the game's Main Image. */
  async function clearFaceImage(gameId: number, face: HomeLayout): Promise<void> {
    setCardMenu(null)
    await window.library.clearHomeImage(gameId, face)
    await onGamesChanged()
  }

  /* Any press outside the plate, a second right-click, or Escape dismisses it
     — the same rule the side panel's rows and the Progress triangle follow. */
  const cardOpener = useContextMenuDismiss(cardMenu !== null, () => setCardMenu(null))

  /* The plate is as wide as its longest option and the press can land anywhere
     on the board, so it is put where the pointer was and then pulled back
     inside the board. Measured once it is laid out and before it is painted, so
     it does not move on screen; the rect is converted by the board's own known
     width, as everything else placed in this space is. */
  useLayoutEffect(() => {
    const board = boardRef.current
    if (!cardMenu || !board) return
    const plate = board.querySelector<HTMLElement>('.context-menu')
    if (!plate) return
    const boardRect = board.getBoundingClientRect()
    const scale = boardRect.width / BOARD_WIDTH
    const rect = plate.getBoundingClientRect()
    const left = Math.max(0, Math.min(cardMenu.left, BOARD_WIDTH - rect.width / scale))
    const top = Math.max(0, Math.min(cardMenu.top, (boardRect.height - rect.height) / scale))
    if (Math.abs(left - cardMenu.left) > 0.5 || Math.abs(top - cardMenu.top) > 0.5) {
      setCardMenu({ ...cardMenu, left, top })
    }
  }, [cardMenu])

  /* What the grid is being asked for. The cards arrive again whenever that
     changes — a different order, group, search or tag row is a different list
     and reads as one — so the face is keyed on it and remounts, which is what
     re-runs the arrival (and puts the scroll back to the top, the list under it
     no longer being the one that was scrolled). */
  const question = useMemo(
    () =>
      JSON.stringify([
        sortKey,
        groupName,
        query,
        /* Written chips only. A blank one is what ADD TAG + puts out for a
           name to be typed into and narrows nothing, so putting it on the row
           is not a new question and must not shelve the list again. */
        tagFilters.map((chip) => chip.text).filter((text) => text !== '')
      ]),
    [sortKey, groupName, query, tagFilters]
  )

  const shown = useMemo(
    () =>
      sortGames(
        filterGames(games, tags, {
          query,
          group: groupName,
          tagTerms: tagFilters.map((chip) => chip.text)
        }),
        sortKey
      ),
    [games, tags, query, groupName, tagFilters, sortKey]
  )

  /* Nor is what was under the pointer still under it once the list has been
     asked something else: the cards have been remounted and moved, and no
     `mouseover` comes until the pointer does. */
  useEffect(() => {
    const held = releases.current
    held.forEach((timer) => clearTimeout(timer))
    held.clear()
    grownAt.current.clear()
    over.current = null
    setGrown([])
    setHover(null)
  }, [question])

  // A card that has been filtered out cannot be the one under the pointer.
  useEffect(() => {
    if (hover !== null && !shown.some((game) => game.id === hover.id)) setHover(null)
  }, [shown, hover])

  // Nor can it be one that is still on its way back to its own size.
  useEffect(() => {
    setGrown((list) => {
      const kept = list.filter((id) => shown.some((game) => game.id === id))
      return kept.length === list.length ? list : kept
    })
  }, [shown])

  /* Where a menu hangs, in the board's own design pixels. It is measured when
     the row is opened rather than written down: `position: fixed` and
     `getBoundingClientRect` do not share the shell's coordinate space, so the
     rect is converted by the board's own known width — the same conversion the
     Setting board makes against its 1585. */
  function placeMenu(key: 'sort' | 'group' | 'group-suggest', row: HTMLElement): void {
    const board = boardRef.current
    if (!board) return
    const boardRect = board.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const scale = boardRect.width / BOARD_WIDTH
    anchorRef.current = row
    setMenu({
      key,
      top: (rect.bottom - boardRect.top) / scale + MENU_GAP,
      left: (rect.left - boardRect.left) / scale
    })
  }

  function toggleMenu(key: 'sort' | 'group', row: HTMLElement): void {
    if (menu?.key === key) {
      setMenu(null)
      return
    }
    placeMenu(key, row)
  }

  /* The suggestions hang off the whole row rather than off the field, so they
     line up with the list the ▼ drops out of the same pill.

     **A blank is not something typed.** A field holding only spaces has
     nothing in it: it puts no suggestions up and — `filterGames` trimming what
     it is given — narrows the grid by nothing either, so a stray space can
     neither empty the board nor stand as a search of its own. */
  function openGroupSuggestions(text: string): void {
    const row = groupRef.current
    if (!row) return
    if (text.trim()) placeMenu('group-suggest', row)
    else setMenu((open) => (open?.key === 'group-suggest' ? null : open))
  }

  /** Settles the field: what it holds becomes what the grid is narrowed to. */
  function commitGroup(text: string): void {
    setGroupText(text)
    setGroupName(text)
  }

  function addTag(): void {
    const id = nextTagId.current++
    setTagFilters((list) => [...list, { id, text: '' }])
    setNewTagId(id)
  }

  /** What a chip was left holding. Nothing in it takes the chip away. */
  function commitTag(id: number, text: string): void {
    setNewTagId((current) => (current === id ? null : current))
    setTagFilters((list) =>
      text.trim() === ''
        ? list.filter((chip) => chip.id !== id)
        : list.map((chip) => (chip.id === id ? { ...chip, text: text.trim() } : chip))
    )
  }

  function deleteTag(id: number): void {
    setNewTagId((current) => (current === id ? null : current))
    setTagFilters((list) => list.filter((chip) => chip.id !== id))
  }

  // A chip added past the end of the row is scrolled to.
  useEffect(() => {
    if (newTagId === null) return
    const row = tagsRef.current
    if (row) row.scrollLeft = row.scrollWidth
  }, [newTagId])

  /* The row carries no scrollbar, so the wheel is the whole of how it moves.
     A vertical wheel over a box that only scrolls across does nothing in
     Chromium, and left alone it would scroll the grid below instead — so the
     delta is turned sideways here and the event stopped. React's own `onWheel`
     is registered passive and cannot stop it, hence the native listener; the
     Add Game dialog's tag row is the same. */
  useEffect(() => {
    const row = tagsRef.current
    if (!row) return
    const onWheel = (event: WheelEvent): void => {
      if (row.scrollWidth <= row.clientWidth) return
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      if (delta === 0) return
      event.preventDefault()
      // Line and page deltas, which some mice report, in pixels.
      const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1
      row.scrollLeft += delta * scale
    }
    row.addEventListener('wheel', onWheel, { passive: false })
    return () => row.removeEventListener('wheel', onWheel)
  }, [])

  /** A cell is the same on both faces: it grows, and it names its game to the
      hover, which the face above it works out from the pointer. */
  function cellProps(id: number): React.HTMLAttributes<HTMLDivElement> & { 'data-game-id': number } {
    return {
      className: `home-card-cell ${grown.includes(id) ? 'is-hovered' : ''}`,
      'data-game-id': id
    }
  }

  /* Both handlers on the face rather than on each cell, and `onMouseOver` as
     well as `onMouseMove`: a pointer thrown across the board can land on a
     card without a single move being delivered over it — the moves in between
     are coalesced and the last one lands somewhere else — and then nothing
     came up at all. `mouseover` fires on entering whatever is under the
     pointer whether or not a move follows, so between the two there is always
     an event for the card that was arrived at. */
  /** How long the card at `index` waits before it arrives. */
  function arriveDelay(index: number): number {
    const step = (index % GRID_COLUMNS) + Math.floor(index / GRID_COLUMNS)
    return Math.min(step * ARRIVE_STEP_MS, ARRIVE_MAX_MS)
  }

  /** The same for a spine, which is put away in the order it stands in. */
  function shelveDelay(index: number): number {
    return Math.min(index * SHELVE_STEP_MS, SHELVE_MAX_MS)
  }

  function leaveFace(): void {
    if (over.current !== null) release(over.current)
    over.current = null
    setHover(null)
  }

  const faceHover: React.HTMLAttributes<HTMLDivElement> = {
    onMouseMove: trackHover,
    onMouseOver: trackHover,
    onMouseLeave: leaveFace,
    onContextMenu: openCardMenu
  }

  /** The game the panel is for, which the grid may have filtered away. */
  const hovered = hover ? shown.find((game) => game.id === hover.id) : undefined

  /** The same for the cell the menu was opened on. */
  const menuGame = cardMenu ? shown.find((game) => game.id === cardMenu.gameId) : undefined

  const groupOptions = useMemo(() => {
    if (menu?.key !== 'group' && menu?.key !== 'group-suggest') return []
    const rows = groups.map((group) => ({
      key: String(group.id),
      label: group.name,
      color: group.color
    }))
    if (menu.key === 'group') return [{ key: ALL_GROUPS_KEY, label: 'すべて' }, ...rows]
    /* The suggestions are the list narrowed to what has been typed, and leave
       the 「すべて」 row off: that row belongs to the whole list rather than to
       a search. Nothing matching means no rows, and no rows means no board.
       The match is `filter.ts`'s own, so a menu offers exactly the groups the
       grid under it is being narrowed to. */
    return rows.filter((row) => suggestsGroup(row.label, groupText))
  }, [groups, menu, groupText])

  return (
    <div className="home-board" ref={boardRef}>
      {/* Penpot: Top — 1515x106 */}
      <div className="home-top">
        <div className="home-headline">
          <h1 className="home-word">Home</h1>

          {/* Penpot: Under Line — a 172px bar plus a 132x8 tapering triangle */}
          <div className="home-underline">
            <span className="home-underline-bar" />
            <svg className="home-underline-tail" viewBox="0 0 132 8" preserveAspectRatio="none">
              <path d="M0,0 L132,0 L0,8 Z" fill="#e1e8ed" />
            </svg>
          </div>
        </div>

        {/* Penpot: Show Condition — 1034x106 */}
        <div className="home-condition">
          <div className="home-others">
            {/* Penpot: Way to Sort — 239x52. The order is one of a fixed list,
                so nothing is typed into it: the field says which one is on and
                the menu is the only way to change it, which is what the side
                panel's own Sort field is. */}
            <button
              className="home-select"
              ref={sortRef}
              onClick={(event) => toggleMenu('sort', event.currentTarget)}
              title="並び順を選ぶ"
              aria-haspopup="menu"
              aria-expanded={menu?.key === 'sort'}
            >
              <span className="home-select-value sort">
                <FitLabel label={sortLabel(sortKey)} width={189 - 30 * 2} />
              </span>
              <span className="home-select-caret">
                <span className="home-caret-glyph">▼</span>
              </span>
            </button>

            {/* Penpot: Group Select — 331x52. Unlike the order beside it a
                group's name is free text, so this half of the pill is typed
                into the way the side panel's Select Group is: the ▼ drops the
                whole list out of the row, typing narrows that same board to
                what a name contains, and the design's own "GROUP" is what the
                field says while nothing is in it. */}
            <div className="home-select" ref={groupRef}>
              <span className="home-select-value group">
                <input
                  className="home-select-input"
                  placeholder="GROUP"
                  value={groupText}
                  onChange={(event) => {
                    /* A blank is nothing typed: a field holding only spaces
                       goes back to being empty, so it says the design's own
                       GROUP again rather than standing there looking filled
                       in while it narrows the grid by nothing. Only a run
                       that is *all* whitespace goes — a space inside a name
                       is part of the name. */
                    const text = event.target.value.trim() ? event.target.value : ''
                    if (text) setGroupText(text)
                    else commitGroup('')
                    openGroupSuggestions(text)
                  }}
                  onKeyDown={(event) => {
                    /* Enter settles the field. Not the Enter that ends an IME
                       conversion, though — that one is choosing a character,
                       and a group written in Japanese would otherwise be
                       searched for one syllable at a time. */
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    commitGroup(groupText)
                    setMenu(null)
                  }}
                  onFocus={() => openGroupSuggestions(groupText)}
                  onBlur={() => {
                    commitGroup(groupText)
                    setMenu((open) => (open?.key === 'group-suggest' ? null : open))
                  }}
                  aria-label="グループで絞り込む"
                />
              </span>
              <button
                className="home-select-caret"
                onClick={(event) => toggleMenu('group', event.currentTarget.parentElement!)}
                title="グループ一覧"
                aria-label="グループ一覧"
                aria-haspopup="menu"
                aria-expanded={menu?.key.startsWith('group') ?? false}
              >
                <span className="home-caret-glyph">▼</span>
              </button>
            </div>

            {/* Penpot: Search Box — 404x52. The design's "SEARCH..." is what
                the field says while nothing has been typed into it. */}
            <div className="home-search">
              <input
                className="home-search-input"
                placeholder="SEARCH..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="ゲームを検索"
              />
            </div>
          </div>

          {/* Penpot: Tag — 1034x39 */}
          <div className="home-tag-row">
            <button className="home-add-tag" onClick={addTag} title="タグで絞り込む">
              <span className="home-chip-label">ADD TAG +</span>
            </button>
            <span className="home-tag-rule" />
            {/* Penpot draws the button and the chips it makes; the chip itself
                is the app's own, restyled here to the design's own pill. */}
            <div className="home-tag-container" ref={tagsRef}>
              {tagFilters.map((chip) => (
                <TagChip
                  key={chip.id}
                  name={chip.text}
                  editing={chip.id === newTagId}
                  onCommit={(text) => commitTag(chip.id, text)}
                  onDelete={() => deleteTag(chip.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Penpot: Number of VN — the design's "9999 games", which counts what
          the filters have left rather than the whole library. */}
      <div className="home-count">
        <span className="home-count-text">
          <span className="home-count-number">{shown.length}</span> games
        </span>

        {/* Not in the design, which draws the count against the right edge and
            nothing beside it: the count is moved in by what these take, and
            they stand in the room that makes. */}
        <div className="home-layout-toggle" role="group" aria-label="表示を切り替える">
          <button
            className={`home-layout-button ${layout === 'grid' ? 'chosen' : ''}`}
            onClick={() => onLayoutChange('grid')}
            title="サムネイル表示"
            aria-pressed={layout === 'grid'}
          >
            <i className="fa-solid fa-table-cells-large" />
          </button>
          <button
            className={`home-layout-button ${layout === 'shelf' ? 'chosen' : ''}`}
            onClick={() => onLayoutChange('shelf')}
            title="背表紙表示"
            aria-pressed={layout === 'shelf'}
          >
            <i className="fa-solid fa-barcode" />
          </button>
        </div>
      </div>

      {/* Penpot: Border — 1525x1 */}
      <div className="home-rule" />

      {/* Penpot: Container — the 5-wide grid of cards; or, where the barcode
          is the one that is on, its "Bookshelf Container" — the same slot as a
          shelf of 25 spines across. Both are the same list under the same
          filters, and a cell is a cell either way: it carries the hover and it
          opens the game's board. */}
      {layout === 'grid' ? (
        <div className="home-face" key={question} {...faceHover}>
          <div className="home-grid">
            {shown.map((game, index) => (
              <div
                key={game.id}
                {...cellProps(game.id)}
                style={{ animationDelay: `${arriveDelay(index)}ms` }}
              >
                {/* No `title` on the card: the Game Hover already carries the
                    name and everything else about the game, and a native
                    tooltip comes up over it. */}
                <button
                  className="home-card"
                  onClick={() => onSelect(game.id)}
                  aria-label={game.title}
                >
                  {/* Penpot: Thumbnail — 253x304, at 5:6. The picture is the game's
                      Main Image, which is whichever of its images is applied as
                      the thumbnail; a game with none is left with the design's
                      plate. */}
                  <span className="home-card-thumb">
                    <FaceImage game={game} face="grid" />
                  </span>

                  {/* Penpot: Border — 253x1 */}
                  <span className="home-card-border" />

                  {/* Penpot: Title — "title
title", two lines. The short
                      name stands in where the game opts into it, exactly as it
                      does on the side panel's rows: two lines is all a card
                      has, and a title past them is cut off — which is the case
                      the setting is there for. */}
                  <span className="home-card-title">
                    <span className="home-card-title-text">{displayName(game)}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="home-face" key={question} {...faceHover}>
          <div className="home-shelf">
            {shown.map((game, index) => (
              <div
                key={game.id}
                {...cellProps(game.id)}
                style={{ animationDelay: `${shelveDelay(index)}ms` }}
              >
                {/* Penpot draws a spine as a plain 57x358 rectangle and writes
                    nothing on it. It carries the same Main Image the card does,
                    cropped to the slice a spine is; which game it is, is what
                    the Game Hover under the pointer says. */}
                <button
                  className="home-spine"
                  onClick={() => onSelect(game.id)}
                  aria-label={game.title}
                >
                  <FaceImage game={game} face="shelf" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Penpot board "Game Hover" — 346x255 at three fifths. It follows the
          pointer, so it is a child of the board rather than of the card: the
          grid clips (it scrolls) and the panel has to be free of it. */}
      {hover && hovered && !cardMenu && (
        <div className="home-card-hover" style={{ left: hover.left, top: hover.top }}>
          <GameHover game={hovered} />
        </div>
      )}

      {/* Not in the design: a cell's own menu, the same plate the side panel's
          rows put up. It offers the face it was opened on and no other — the
          cell the press landed on is a card or a spine, not both, and a picture
          for the face that is not on the screen could not be seen to have
          landed. The option says the shape the picture will be cropped to,
          since that is the only thing the cell can tell you about it. */}
      {cardMenu && menuGame && (
        <ContextMenu
          style={{ left: cardMenu.left, top: cardMenu.top }}
          items={[
            {
              label: `${FACE_NAME[layout]}を変更 (${FACE_RATIO[layout]})`,
              onSelect: () => void pickFaceImage(menuGame.id, layout)
            },
            /* Only where there is one to give back: with nothing set, the
               cell is already showing the game's Main Image. */
            ...((layout === 'shelf' ? menuGame.homeSpineImage : menuGame.homeCardImage)
              ? [
                  {
                    label: `${FACE_NAME[layout]}を戻す`,
                    onSelect: () => void clearFaceImage(menuGame.id, layout)
                  }
                ]
              : [])
          ]}
        />
      )}

      {/* No rows, no board: a search matching no group puts nothing up rather
          than an empty plate, which is what the side panel's own field does. */}
      {menu && (menu.key === 'sort' || groupOptions.length > 0) && (
        <OptionMenu
          options={
            menu.key === 'sort'
              ? SORTS.map((sort) => ({ key: sort.key, label: sort.label }))
              : groupOptions
          }
          top={menu.top}
          left={menu.left}
          width={menu.key === 'sort' ? SORT_WIDTH : GROUP_WIDTH}
          maxRows={menu.key === 'sort' ? SORTS.length : GROUP_MENU_ROWS}
          onPick={(key) => {
            if (menu.key === 'sort') {
              setSortKey(key as SortKey)
            } else if (key === ALL_GROUPS_KEY) {
              commitGroup('')
            } else {
              const picked = groups.find((group) => String(group.id) === key)
              if (picked) commitGroup(picked.name)
            }
            setMenu(null)
          }}
          onDismiss={() => setMenu(null)}
          anchorRef={anchorRef}
        />
      )}
    </div>
  )
}

/**
 * What a cell draws: the picture that face was given from its own right-click
 * menu, and the game's Main Image where it has not been given one. The two are
 * read nowhere else, which is what keeps a picture set on a card to that card.
 */
function FaceImage({
  game,
  face
}: {
  game: GameWithStats
  face: HomeLayout
}): React.JSX.Element | null {
  const picture =
    (face === 'shelf' ? game.homeSpineImage : game.homeCardImage) ?? game.thumbnailPath
  return picture ? <img src={mediaUrl(picture)} alt="" /> : null
}

/* Penpot sets both field labels at 35px, and "SORT" and "GROUP" come to what
   the box leaves for them. An order is a sentence and a group's name is
   whatever was typed, so the label steps down just far enough to fit the way
   the clock's date and the menu's own rows do. */
function FitLabel({ label, width }: { label: string; width: number }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.fontSize = `${FIELD_FONT_SIZE}px`
    const measured = el.scrollWidth
    if (measured > width) {
      el.style.fontSize = `${Math.floor(FIELD_FONT_SIZE * (width / measured))}px`
    }
  }, [label, width])

  return (
    <span className="home-field-label" ref={ref}>
      {label}
    </span>
  )
}
