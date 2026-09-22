import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  GameWithStats,
  NewVoiceInput,
  Voice,
  VoiceCharacter,
  VoicePatch
} from '../../../shared/db-types'
import { t } from '../../../shared/i18n'
import { mediaUrl } from '../../../shared/media-url'
import { useContextMenuDismiss } from '../context-menu'
import { suggestsGroup } from '../filter'
import { displayName } from '../sort'
import AddVoiceDialog from './AddVoiceDialog'
import ConfirmDialog from './ConfirmDialog'
import ContextMenu from './ContextMenu'
import OptionMenu from './OptionMenu'
import './VoiceManager.css'

/** The design's Voice Container: three columns by six rows. */
const VOICES_PER_PAGE = 18
/** The board's own design width, which a press is measured against. */
const BOARD_WIDTH = 1585
/** The Right Click Menu at two options: 10 above and below, two 42 rows, 5 between. */
const CONTEXT_MENU_WIDTH = 201
const CONTEXT_MENU_HEIGHT = 10 + 42 * 2 + 5 + 10
/** The row at the head of a filter's whole list that lets the filter go. */
const ALL_KEY = 'all'
/** A filter's list drops out of its own 467 select, 6 under it. */
const FILTER_MENU_TOP = 49 + 6
const FILTER_MENU_WIDTH = 467
const FILTER_MENU_ROWS = 8

interface Props {
  /** The library, which the Add Voice dialog's Game row is a list of and
      which a card's ground is drawn from. */
  games: GameWithStats[]
  /** The game whose board was up when the board was opened, which the GAME
      filter opens set to — a voice is most often looked for in the game
      being played. */
  initialGame: GameWithStats | null
  /** The saved playback volume the bar opens on, 0–1. */
  initialVolume: number
  /** Persists the volume once the bar is let go of. */
  onVolumeChange: (volume: number) => void
  /** APPLY, once what was added has been kept. */
  onApplied: () => void
  /** CANCEL, with what was added taken back out. */
  onCancel: () => void
}

/**
 * Penpot board "Add Voice" (d3f72a50-bc2e-80de-8008-7ab294474f8f), 1585x984 in
 * the Main Display's slot — the Extra Function board's ボイスマネージャー puts it
 * up. It is the design's own drawing, figure for figure: the VOICE headline
 * over its Under Line, the GAME and CHARACTER selects over the Search Box, a
 * Voice Container of three columns by six rows, and the ADD VOICE / APPLY /
 * CANCEL row with the Page Switcher beside it.
 *
 * **ADD VOICE puts Penpot's "ADD VOICE" dialog up over the board**
 * (`AddVoiceDialog`), and what it writes is a row of `voices`, drawn in the
 * container as the design's Voice card — the title over the character's name,
 * over a player that plays it. **The board is APPLY and CANCEL the way the
 * Add Thumbnail board is**: a voice added has to be written on the way (its
 * copy has to be under `userData` for `fvn-media:` to play it), so the board
 * keeps the ids it added, APPLY keeps them and CANCEL — or the board being
 * left by any other door — takes them out again, files and all. A right
 * press on a card offers 情報を変更 (the same dialog, filled in) and 削除
 * (asked about first); both are staged until APPLY the way the gallery's
 * deletions are, so CANCEL leaves the library as the board found it.
 *
 * **GAME, CHARACTER and SEARCH narrow the container.** The two selects are
 * the Home board's own Group pill twice over: the ▼ drops the whole list with
 * 「すべて」 over it, typing narrows that same board to the names *beginning
 * with* what has been typed, and the container is narrowed to the one of
 * exactly that name once the field is settled — on a row picked, on Enter,
 * or on the caret leaving. SEARCH matches what a title *contains*, as it is
 * typed. **The Page Switcher is a page of eighteen**, the container's own
 * three by six, over whatever the three have left.
 */
export default function VoiceManager({
  games,
  initialGame,
  initialVolume,
  onVolumeChange,
  onApplied,
  onCancel
}: Props): React.JSX.Element {
  const [voices, setVoices] = useState<Voice[]>([])
  const [characters, setCharacters] = useState<VoiceCharacter[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Voice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  /** The one voice playing; a second one pressed pauses the first. */
  const [playing, setPlaying] = useState<number | null>(null)
  /** Playback volume for every card, 0–1, opened on the saved level and saved
      again when the bar is let go of. */
  const [volume, setVolume] = useState(initialVolume)
  /* The voices added since the board was opened, which is what CANCEL takes
     back out. A ref beside the state, so the unmount effect reads what stands
     at the moment the board goes rather than what it was set up with. */
  const [added, setAdded] = useState<number[]>([])
  const addedRef = useRef<number[]>([])
  const committed = useRef(false)
  /* What is staged and not yet written: the voices to go, and the rows
     rewritten from 情報を変更, each held as the patch APPLY will send. The
     local list already shows both. */
  const [removed, setRemoved] = useState<Voice[]>([])
  const [edits, setEdits] = useState<Map<number, VoicePatch>>(new Map())
  const [deleting, setDeleting] = useState<Voice | null>(null)

  /* The right press on a card, placed against the board in its own design
     pixels the way every right-click menu in the app is. */
  const [menu, setMenu] = useState<{ voice: Voice; left: number; top: number } | null>(null)
  const menuOpener = useContextMenuDismiss(menu !== null, () => setMenu(null))
  /* The character list a card's name/+ drops, placed against the board in the
     same design pixels the right-click menu is, and as wide as the card. */
  const [cardCharMenu, setCardCharMenu] = useState<{
    voice: Voice
    left: number
    top: number
    width: number
    /** Which way it unfolds: down out of the card, or up when there is no room
        below it. */
    flip: 'up' | 'down'
  } | null>(null)
  const charMenuOpener = useContextMenuDismiss(cardCharMenu !== null, () => setCardCharMenu(null))
  const [charAdding, setCharAdding] = useState(false)

  /* The three filters. A select's text and the name the container is
     narrowed to are two pieces of state, settled the way the Home board's
     Group field is. */
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [gameText, setGameText] = useState(initialGame ? displayName(initialGame) : '')
  const [gameFilter, setGameFilter] = useState(initialGame ? displayName(initialGame) : '')
  const [gameMenu, setGameMenu] = useState<'none' | 'all' | 'suggest'>('none')
  const gameRef = useRef<HTMLDivElement | null>(null)
  const [charText, setCharText] = useState('')
  const [charFilter, setCharFilter] = useState('')
  const [charMenu, setCharMenu] = useState<'none' | 'all' | 'suggest'>('none')
  const charRef = useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.library.listVoices(), window.library.listVoiceCharacters()]).then(
      ([list, names]) => {
        if (cancelled) return
        setVoices(list)
        setCharacters(names)
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  const gameName = useCallback(
    (id: number | null): string => {
      const game = id === null ? undefined : games.find((one) => one.id === id)
      return game ? displayName(game) : ''
    },
    [games]
  )
  const characterName = useCallback(
    (id: number | null): string => characters.find((one) => one.id === id)?.name ?? '',
    [characters]
  )

  /* What the three filters leave, in the list's own order. A game or a
     character is matched whole, the way a tag is; the search is what a
     title contains. */
  const shownAll = useMemo(() => {
    const game = gameFilter.trim().toLowerCase()
    const character = charFilter.trim().toLowerCase()
    const term = search.trim().toLowerCase()
    return voices.filter(
      (voice) =>
        (!game || gameName(voice.gameId).trim().toLowerCase() === game) &&
        (!character || characterName(voice.characterId).trim().toLowerCase() === character) &&
        (!term || voice.title.toLowerCase().includes(term))
    )
  }, [voices, gameFilter, charFilter, search, gameName, characterName])

  /* A list asked something else starts at its first page. */
  useEffect(() => {
    setPage(0)
  }, [gameFilter, charFilter, search])

  const pages = Math.max(1, Math.ceil(shownAll.length / VOICES_PER_PAGE))
  /* A page past the end — the last card of the last page taken off — falls
     back to the last there is. */
  const current = Math.min(page, pages - 1)
  const shown = shownAll.slice(current * VOICES_PER_PAGE, (current + 1) * VOICES_PER_PAGE)

  /* The mouse wheel over the container turns the page — down for the next, up
     for the previous — one page a notch, with a short cooldown so a trackpad's
     momentum does not skip several at once. There is nothing to scroll here, so
     the event is stopped; a native non-passive listener is what lets it be
     (React's own `onWheel` is registered passive). */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cooldown = 0
    const onWheel = (event: WheelEvent): void => {
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      if (delta === 0) return
      event.preventDefault()
      const now = Date.now()
      if (now < cooldown) return
      cooldown = now + 200
      const dir = delta > 0 ? 1 : -1
      setPage((p) => Math.max(0, Math.min(pages - 1, Math.min(p, pages - 1) + dir)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pages])

  async function addVoice(input: NewVoiceInput): Promise<void> {
    setAdding(false)
    try {
      const list = await window.library.addVoice(input)
      const newest = list[list.length - 1]
      if (newest && !voices.some((one) => one.id === newest.id)) {
        addedRef.current = [...addedRef.current, newest.id]
        setAdded(addedRef.current)
        // The local list carries the staged edits, so only the new row is
        // taken from what came back.
        setVoices((was) => [...was, newest])
      }
      // The card lands on the last page, which is where the eye goes.
      setPage(Math.max(0, Math.ceil((shownAll.length + 1) / VOICES_PER_PAGE) - 1))
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*Error: /, '') : String(err))
    }
  }

  /* 情報を変更, staged: the card shows the change and APPLY writes it. A
     file picked anew is the one part that has to reach the main process,
     which copies it in as the patch is applied. */
  function editVoice(input: NewVoiceInput): void {
    const voice = editing
    setEditing(null)
    if (!voice) return
    const openedOn = voice.sourcePath ?? voice.filePath
    const patch: VoicePatch = {
      gameId: input.gameId,
      characterId: input.characterId,
      title: input.title,
      ...(input.sourcePath !== openedOn ? { sourcePath: input.sourcePath } : {})
    }
    setEdits((was) => new Map(was).set(voice.id, patch))
    setVoices((was) =>
      was.map((one) =>
        one.id === voice.id
          ? {
              ...one,
              gameId: patch.gameId,
              characterId: patch.characterId,
              title: patch.title,
              sourcePath: patch.sourcePath ?? one.sourcePath
            }
          : one
      )
    )
  }

  /* One field of a voice changed in place — the title typed on the card, or a
     character picked from its menu. It is staged like 情報を変更 (APPLY writes
     it) and merged onto any patch already held for the voice, keeping a file it
     may have staged. */
  function stageField(voice: Voice, changes: Partial<Pick<Voice, 'title' | 'characterId'>>): void {
    const next = { ...voice, ...changes }
    setEdits((was) => {
      const prev = was.get(voice.id)
      const patch: VoicePatch = {
        gameId: next.gameId,
        characterId: next.characterId,
        title: next.title,
        ...(prev?.sourcePath ? { sourcePath: prev.sourcePath } : {})
      }
      return new Map(was).set(voice.id, patch)
    })
    setVoices((was) => was.map((one) => (one.id === voice.id ? next : one)))
  }

  /* Adds a character and hands back its id, so a card that made one from its own
     menu can file the voice under it at once. */
  async function addCharacter(name: string): Promise<number | null> {
    const list = await window.library.addVoiceCharacter(name)
    setCharacters(list)
    return list.find((one) => one.name === name)?.id ?? null
  }

  /* Opens the character list under a card's name/+, in the board's own design
     pixels and as wide as the card. */
  function openCharMenu(voice: Voice, event: React.MouseEvent): void {
    // A second press on the same card's + is a toggle: put the list away rather
    // than reopening it. The button's own mousedown is stopped (see the card) so
    // the outside-press dismissal does not close it first and let this reopen it.
    if (cardCharMenu && cardCharMenu.voice.id === voice.id) {
      setCardCharMenu(null)
      return
    }
    const target = event.currentTarget as HTMLElement
    const board = target.closest('.add-voice')
    const card = target.closest('.voice-card')
    if (!board || !card) return
    const box = board.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    const scale = box.width / BOARD_WIDTH
    const boardHeight = box.height / scale
    const cardTop = (cardBox.top - box.top) / scale
    const cardBottom = (cardBox.bottom - box.top) / scale
    /* The list's own height: its rows (capped where it scrolls) plus the add
       row, plus a clear row when a character is set. A card near the bottom has
       no room under it, so the menu opens above it instead. */
    const CHAR_ROW = 40
    const CHAR_LIST_MAX = 240
    const menuHeight =
      Math.min(characters.length * CHAR_ROW, CHAR_LIST_MAX) +
      CHAR_ROW +
      (voice.characterId !== null ? CHAR_ROW : 0)
    const flipUp = cardBottom + 4 + menuHeight > boardHeight && cardTop - 4 - menuHeight >= 0
    charMenuOpener.current = target
    setCharAdding(false)
    setCardCharMenu({
      voice,
      left: (cardBox.left - box.left) / scale,
      top: flipUp ? cardTop - 4 - menuHeight : cardBottom + 4,
      width: cardBox.width / scale,
      flip: flipUp ? 'up' : 'down'
    })
  }

  function stageDelete(voice: Voice): void {
    setDeleting(null)
    setRemoved((was) => [...was, voice])
    setVoices((was) => was.filter((one) => one.id !== voice.id))
    if (playing === voice.id) setPlaying(null)
  }

  const discardAdded = useCallback(async (): Promise<void> => {
    const ids = addedRef.current
    if (ids.length === 0) return
    addedRef.current = []
    for (const id of ids) await window.library.deleteVoice(id)
  }, [])

  const dirty = added.length > 0 || removed.length > 0 || edits.size > 0

  /* The deletions first, so a voice staged to go is never rewritten; what
     was added is simply kept. */
  async function apply(): Promise<void> {
    committed.current = true
    try {
      for (const voice of removed) await window.library.deleteVoice(voice.id)
      for (const [id, patch] of edits) {
        if (removed.some((voice) => voice.id === id)) continue
        await window.library.updateVoice(id, patch)
      }
    } catch (err) {
      committed.current = false
      setError(err instanceof Error ? err.message.replace(/^.*Error: /, '') : String(err))
      return
    }
    addedRef.current = []
    setAdded([])
    onApplied()
  }

  async function cancel(): Promise<void> {
    committed.current = true
    await discardAdded()
    onCancel()
  }

  useEffect(
    () => () => {
      if (!committed.current) void discardAdded()
    },
    [discardAdded]
  )

  function openMenu(voice: Voice, event: React.MouseEvent): void {
    const board = (event.currentTarget as HTMLElement).closest('.add-voice')
    if (!board) return
    event.preventDefault()
    menuOpener.current = event.currentTarget as HTMLElement
    const box = board.getBoundingClientRect()
    const scale = box.width / BOARD_WIDTH
    setMenu({
      voice,
      left: Math.min((event.clientX - box.left) / scale, BOARD_WIDTH - CONTEXT_MENU_WIDTH),
      top: Math.min((event.clientY - box.top) / scale, box.height / scale - CONTEXT_MENU_HEIGHT)
    })
  }

  /* The rows a filter's list shows: 「すべて」 over the whole list, or the
     names beginning with what has been typed and nothing else. */
  const gameOptions = useMemo(() => {
    if (gameMenu === 'none') return []
    const rows = games
      .filter((game) => gameMenu === 'all' || suggestsGroup(displayName(game), gameText))
      .map((game) => ({
        key: String(game.id),
        label: displayName(game),
        // The game's own icon at the row's left, the way the Ledger's game list
        // carries it — a name is quicker to find beside the picture it is filed
        // under.
        iconUrl: game.iconPath ? mediaUrl(game.iconPath) : ''
      }))
    return gameMenu === 'all' ? [{ key: ALL_KEY, label: t('すべて') }, ...rows] : rows
  }, [games, gameMenu, gameText])
  const charOptions = useMemo(() => {
    if (charMenu === 'none') return []
    const rows = characters
      .filter((one) => charMenu === 'all' || suggestsGroup(one.name, charText))
      .map((one) => ({ key: String(one.id), label: one.name }))
    return charMenu === 'all' ? [{ key: ALL_KEY, label: t('すべて') }, ...rows] : rows
  }, [characters, charMenu, charText])

  const gameThumbnail = (voice: Voice): string | null =>
    voice.gameId === null
      ? null
      : (games.find((one) => one.id === voice.gameId)?.thumbnailPath ?? null)

  return (
    <section className="add-voice">
      {/* Penpot: Top — 1515x106 at 35/30, the Headline against the Show Condition */}
      <div className="voice-top">
        {/* Penpot: Headline — 304x106, "VOICE" over the Under Line */}
        <div className="voice-headline">
          <h1 className="voice-word">VOICE</h1>
          {/* Penpot: Under Line — 304x8, a 172px bar then a 132px taper */}
          <div className="voice-underline">
            <span className="voice-underline-bar" />
            <svg className="voice-underline-tail" viewBox="0 0 132 8" preserveAspectRatio="none">
              <path d="M0,0 L132,0 L0,8 Z" fill="#e1e8ed" />
            </svg>
          </div>
        </div>

        {/* Penpot: Show Condition — 954x106, the two selects over the Search Box */}
        <div className="voice-condition">
          {/* Penpot: Game / Select — 954x49, two 467-wide selects 20 apart */}
          <div className="voice-selects">
            {/* Penpot: Game Select — a 417 pill with 100 of padding either side
                and the 50-wide Show Groups ▼ beside it. The design's own word
                stands as the field's placeholder. */}
            <FilterSelect
              className="game"
              placeholder="GAME"
              text={gameText}
              menu={gameMenu}
              options={gameOptions}
              anchorRef={gameRef}
              listTitle={t('ゲーム一覧')}
              onText={(text) => {
                setGameText(text)
                setGameMenu(text.trim() ? 'suggest' : 'none')
                if (!text.trim()) setGameFilter('')
              }}
              onMenu={setGameMenu}
              onSettle={() => setGameFilter(gameText)}
              onPick={(key) => {
                setGameMenu('none')
                if (key === ALL_KEY) {
                  setGameText('')
                  setGameFilter('')
                  return
                }
                const picked = games.find((game) => String(game.id) === key)
                if (picked) {
                  setGameText(displayName(picked))
                  setGameFilter(displayName(picked))
                }
              }}
              onClear={() => {
                setGameMenu('none')
                setGameText('')
                setGameFilter('')
              }}
            />
            {/* Penpot: Character Select — the same pill at 46 of padding, with
                the Show Option ▼ */}
            <FilterSelect
              className="character"
              placeholder="CHARACTER"
              text={charText}
              menu={charMenu}
              options={charOptions}
              anchorRef={charRef}
              listTitle={t('キャラクター一覧')}
              onText={(text) => {
                setCharText(text)
                setCharMenu(text.trim() ? 'suggest' : 'none')
                if (!text.trim()) setCharFilter('')
              }}
              onMenu={setCharMenu}
              onSettle={() => setCharFilter(charText)}
              onPick={(key) => {
                setCharMenu('none')
                if (key === ALL_KEY) {
                  setCharText('')
                  setCharFilter('')
                  return
                }
                const picked = characters.find((one) => String(one.id) === key)
                if (picked) {
                  setCharText(picked.name)
                  setCharFilter(picked.name)
                }
              }}
              onClear={() => {
                setCharMenu('none')
                setCharText('')
                setCharFilter('')
              }}
            />
          </div>
          {/* The bottom row: the volume control under GAME on the left (not in
              the design — an icon by a right-rising triangle that sets every
              card's playback volume), and the Search Box held to the right. */}
          <div className="voice-controls">
            <div className="voice-volume-control">
              <i className={`voice-volume-icon fa-solid ${volumeIcon(volume)}`} aria-hidden="true" />
              <VolumeBar volume={volume} onChange={setVolume} onCommit={onVolumeChange} />
            </div>
            {/* Penpot: Search Box — 691x49. It narrows as it is typed, there
                being no button beside it. */}
            <div className="voice-search">
              <input
                className="voice-search-input"
                placeholder="SEARCH..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Penpot: Voice Container — 1585x749, a grid of three columns by six
          rows filled down the columns, 20 between rows and 30 between columns,
          35 above and 50 either side */}
      <div className="voice-container" ref={containerRef}>
        {shown.map((voice) => (
          <VoiceCard
            key={voice.id}
            voice={voice}
            name={characterName(voice.characterId)}
            thumbnail={gameThumbnail(voice)}
            volume={volume}
            playing={playing === voice.id}
            onPlaying={(on) => setPlaying((was) => (on ? voice.id : was === voice.id ? null : was))}
            onContextMenu={(event) => openMenu(voice, event)}
            onRename={(title) => stageField(voice, { title })}
            onOpenCharMenu={(event) => openCharMenu(voice, event)}
          />
        ))}
      </div>

      {/* Penpot: Bottom — 1585x99, row-reverse, 30px gap, 50px side padding */}
      <div className="voice-bottom">
        {/* Penpot: Buttons — 1170x61, 30px gap */}
        <div className="voice-buttons">
          <button type="button" className="voice-button add-voice" onClick={() => setAdding(true)}>
            ADD VOICE
          </button>
          <button
            type="button"
            className="voice-button apply"
            onClick={() => void apply()}
            disabled={!dirty}
            title={!dirty ? t('変更はありません') : undefined}
          >
            APPLY
          </button>
          <button type="button" className="voice-button cancel" onClick={() => void cancel()}>
            CANCEL
          </button>
        </div>

        {/* Penpot: Page Switcher — 273x44, 2px gap, centred: 1 ⋯ 49 [50] 51 ⋯ 99 */}
        <Pager pages={pages} current={current} onPick={setPage} />
      </div>

      {/* The two things a card can be made to do, on the same plate and the
          same rule every other right press in the app follows. */}
      {menu && (
        <ContextMenu
          style={{ left: `${menu.left}px`, top: `${menu.top}px` }}
          items={[
            {
              label: t('情報を変更'),
              onSelect: () => {
                setEditing(menu.voice)
                setMenu(null)
              }
            },
            {
              label: t('削除'),
              danger: true,
              onSelect: () => {
                setDeleting(menu.voice)
                setMenu(null)
              }
            }
          ]}
        />
      )}

      {/* The character list a card's name/+ drops — the characters, a way to
          clear one, and a row that adds one — as wide as the card it hangs off. */}
      {cardCharMenu && (
        <div
          className={`voice-char-menu${cardCharMenu.flip === 'up' ? ' flip-up' : ''}`}
          style={{
            left: `${cardCharMenu.left}px`,
            top: `${cardCharMenu.top}px`,
            width: `${cardCharMenu.width}px`
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="voice-char-list">
            {cardCharMenu.voice.characterId !== null && (
              <button
                type="button"
                className="voice-char-option is-none"
                onClick={() => {
                  stageField(cardCharMenu.voice, { characterId: null })
                  setCardCharMenu(null)
                }}
              >
                {t('キャラクターなし')}
              </button>
            )}
            {characters.map((character) => (
              <button
                type="button"
                key={character.id}
                className={`voice-char-option${
                  character.id === cardCharMenu.voice.characterId ? ' is-current' : ''
                }`}
                onClick={() => {
                  stageField(cardCharMenu.voice, { characterId: character.id })
                  setCardCharMenu(null)
                }}
              >
                {character.name}
              </button>
            ))}
          </div>
          {charAdding ? (
            <input
              className="voice-char-input"
              autoFocus
              maxLength={40}
              placeholder={t('キャラクター名')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setCharAdding(false)
                  setCardCharMenu(null)
                }
              }}
              onBlur={(event) => {
                const name = event.currentTarget.value.trim()
                const voice = cardCharMenu.voice
                setCardCharMenu(null)
                if (!name) return
                void addCharacter(name).then((id) => {
                  if (id !== null) stageField(voice, { characterId: id })
                })
              }}
            />
          ) : (
            <button type="button" className="voice-char-add" onClick={() => setCharAdding(true)}>
              {t('新しいキャラを追加 ＋')}
            </button>
          )}
        </div>
      )}

      {adding && (
        <AddVoiceDialog
          games={games}
          characters={characters}
          onCharactersChanged={setCharacters}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => void addVoice(input)}
        />
      )}

      {editing && (
        <AddVoiceDialog
          games={games}
          characters={characters}
          voice={editing}
          onCharactersChanged={setCharacters}
          onCancel={() => setEditing(null)}
          onSubmit={editVoice}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="delete voice"
          message={t('「{0}」を削除しますか？', deleting.title)}
          onCancel={() => setDeleting(null)}
          onConfirm={() => stageDelete(deleting)}
        />
      )}

      {error !== null && (
        <ConfirmDialog
          title={t('ボイスマネージャー')}
          message={error}
          onConfirm={() => setError(null)}
        />
      )}
    </section>
  )
}

/**
 * Penpot: Game Select / Character Select — 467x49, the 417 pill and the 50 ▼
 * beside it, with `OptionMenu` dropping out of the row. The field is typed
 * into as well as picked from, and it filters only once it is settled: on
 * a row picked, on Enter — not the Enter that ends an IME conversion — or on
 * the caret leaving. A field emptied out is settled as it happens.
 */
function FilterSelect({
  className,
  placeholder,
  text,
  menu,
  options,
  anchorRef,
  listTitle,
  onText,
  onMenu,
  onSettle,
  onPick,
  onClear
}: {
  className: string
  placeholder: string
  text: string
  menu: 'none' | 'all' | 'suggest'
  options: { key: string; label: string }[]
  anchorRef: React.RefObject<HTMLDivElement>
  listTitle: string
  onText: (text: string) => void
  onMenu: (menu: 'none' | 'all' | 'suggest') => void
  onSettle: () => void
  onPick: (key: string) => void
  /** Clears the field and its filter — the ✕ shown once one is chosen. */
  onClear: () => void
}): React.JSX.Element {
  return (
    <div className="voice-select" ref={anchorRef}>
      <input
        className={`voice-select-value ${className}${text.trim() ? ' has-clear' : ''}`}
        placeholder={placeholder}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onFocus={() => {
          if (text.trim()) onMenu('suggest')
        }}
        onBlur={() => {
          if (menu === 'suggest') onMenu('none')
          onSettle()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            onMenu('none')
            onSettle()
          }
        }}
      />
      {text.trim() && (
        <button
          type="button"
          className="voice-select-clear"
          /* Not the field's blur first, which would settle the name and leave
             this press clearing something already gone. */
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClear}
          title={t('選択を解除')}
          aria-label={t('選択を解除')}
        >
          <i className="fa-solid fa-xmark" />
        </button>
      )}
      <button
        type="button"
        className="voice-select-caret"
        onClick={() => onMenu(menu === 'all' ? 'none' : 'all')}
        title={listTitle}
        aria-label={listTitle}
        aria-expanded={menu !== 'none'}
      >
        <span>▼</span>
      </button>
      {options.length > 0 && (
        <OptionMenu
          options={options}
          top={FILTER_MENU_TOP}
          left={0}
          width={FILTER_MENU_WIDTH}
          maxRows={FILTER_MENU_ROWS + (options[0]?.key === ALL_KEY ? 1 : 0)}
          onPick={onPick}
          onDismiss={() => onMenu('none')}
          anchorRef={anchorRef}
        />
      )}
    </div>
  )
}

/** The speaker mark for a level: muted, then low / medium / high by thirds. */
function volumeIcon(volume: number): string {
  if (volume <= 0) return 'fa-volume-xmark'
  if (volume <= 1 / 3) return 'fa-volume-low'
  if (volume <= 2 / 3) return 'fa-volume'
  return 'fa-volume-high'
}

/* Not in the design: a right-rising triangle that sets the board's playback
   volume — thin on the left, full on the right, the fill running from the left
   up to where the pointer is. A press or a drag on it moves the level. */
function VolumeBar({
  volume,
  onChange,
  onCommit
}: {
  volume: number
  onChange: (volume: number) => void
  /** Called once the press or drag ends — where the level is saved, rather than
      on every frame of a drag. */
  onCommit: (volume: number) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const latest = useRef(volume)
  function setFrom(clientX: number): void {
    const box = ref.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    const next = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    latest.current = next
    onChange(next)
  }
  return (
    <div
      className="voice-volume"
      ref={ref}
      role="slider"
      aria-label={t('音量')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(volume * 100)}
      title={t('音量')}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setFrom(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) setFrom(event.clientX)
      }}
      onPointerUp={() => onCommit(latest.current)}
    >
      <span className="voice-volume-fill" style={{ width: `${volume * 100}%` }} />
    </div>
  )
}

/** mm:ss, the shape the design writes its 00:00 in. */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Penpot: Voice — 475x108: Title / Name over the Player, and the player
 * plays. The clip is an `<audio>` element on `fvn-media:` — a video file
 * plays its sound track through it as readily as a track does — held off
 * screen, with the ▶ driving it, the time reading its position and the bar
 * both showing that position and taking a press or a drag to seek. **A
 * game's Main Image is the card's ground** where the voice is filed under a
 * game that has one: the picture cropped to the card at 30%, over the plate
 * the design draws, so the card still reads as the design's while saying
 * which game the voice is from.
 */
function VoiceCard({
  voice,
  name,
  thumbnail,
  volume,
  playing,
  onPlaying,
  onContextMenu,
  onRename,
  onOpenCharMenu
}: {
  voice: Voice
  name: string
  thumbnail: string | null
  /** Playback volume 0–1, the volume bar's own. */
  volume: number
  playing: boolean
  onPlaying: (on: boolean) => void
  onContextMenu: (event: React.MouseEvent) => void
  /** The title typed on the card, settled on Enter or blur. */
  onRename: (title: string) => void
  /** The name/+ pressed, which drops the character list. */
  onOpenCharMenu: (event: React.MouseEvent) => void
}): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  /** True while the title is being typed, opened by a double-click on it. */
  const [editingTitle, setEditingTitle] = useState(false)
  /* True while the Infinity-duration nudge below is resolving the real length,
     so the seek it costs is put back rather than left as the position. */
  const fixingDuration = useRef(false)

  /* The clip's own length, which the seek bar and the time both need. Some
     encodings report an unknown (Infinity) duration until the whole file has
     been read — a seek past the end makes Chromium resolve it — so without this
     the bar could neither show a length nor seek. */
  function resolveDuration(audio: HTMLAudioElement): void {
    const value = audio.duration
    if (Number.isFinite(value) && value > 0) {
      setDuration(value)
      if (fixingDuration.current) {
        fixingDuration.current = false
        audio.currentTime = 0
        setPosition(0)
      }
    } else if (value === Infinity && !fixingDuration.current) {
      fixingDuration.current = true
      audio.currentTime = 1e101
    }
  }

  /* Another card taking the ▶ puts this one on pause: one voice at a time is
     what the board plays. */
  useEffect(() => {
    const audio = audioRef.current
    if (!playing && audio && !audio.paused) audio.pause()
  }, [playing])

  /* The volume bar's level, applied to this card's own element. */
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  function toggle(): void {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => onPlaying(false))
      onPlaying(true)
    } else {
      audio.pause()
      onPlaying(false)
    }
  }

  /* A press on the bar seeks to where it landed, and holding it drags the
     position with the pointer. */
  function seekTo(clientX: number): void {
    const bar = barRef.current
    const audio = audioRef.current
    if (!bar || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
    const box = bar.getBoundingClientRect()
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    audio.currentTime = share * audio.duration
    setPosition(audio.currentTime)
  }

  const progress = duration > 0 ? Math.min(1, position / duration) : 0

  return (
    <div className="voice-card" title={voice.title} onContextMenu={onContextMenu}>
      {thumbnail && (
        <img className="voice-card-ground" src={mediaUrl(thumbnail)} alt="" draggable={false} />
      )}
      <div className="voice-card-head">
        {editingTitle ? (
          <input
            className="voice-card-title-input"
            autoFocus
            defaultValue={voice.title}
            maxLength={120}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = voice.title
                event.currentTarget.blur()
              }
            }}
            onBlur={(event) => {
              setEditingTitle(false)
              const next = event.currentTarget.value.trim()
              if (next && next !== voice.title) onRename(next)
            }}
          />
        ) : (
          <span
            className="voice-card-title"
            onDoubleClick={() => setEditingTitle(true)}
            title={t('ダブルクリックで名前を変更')}
          >
            {voice.title}
          </span>
        )}
        <span className="voice-card-rule" />
        {/* The character, or a + to file the voice under one — either way a
            button that drops the character list. */}
        <button
          type="button"
          className={`voice-card-name${name ? '' : ' is-empty'}`}
          /* The outside-press dismissal must not fire for this button, or it
             would close the list a click on it means to toggle. */
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onOpenCharMenu}
          title={name || t('キャラクターを設定')}
        >
          {name || '+'}
        </button>
      </div>
      {/* Penpot: Player — 445x44: ▶, a rule, 00:00, the bar */}
      <div className="voice-card-player">
        <audio
          ref={audioRef}
          src={mediaUrl(voice.filePath)}
          preload="metadata"
          onLoadedMetadata={(event) => resolveDuration(event.currentTarget)}
          onDurationChange={(event) => resolveDuration(event.currentTarget)}
          onTimeUpdate={(event) => {
            // Ignore the timeupdate the Infinity-duration seek causes; the real
            // position is 0 until the clip is actually played.
            if (!fixingDuration.current) setPosition(event.currentTarget.currentTime)
          }}
          onEnded={(event) => {
            event.currentTarget.currentTime = 0
            setPosition(0)
            onPlaying(false)
          }}
          onPause={() => onPlaying(false)}
        />
        <button
          type="button"
          className="voice-card-play"
          onClick={toggle}
          title={playing ? t('一時停止') : t('再生')}
          aria-label={playing ? t('一時停止') : t('再生')}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'}`} />
        </button>
        <span className="voice-card-player-rule" />
        {/* Until it is played the time reads the clip's own length; once it is
            playing (or paused partway) it reads the position. */}
        <span className="voice-card-time" title={duration > 0 ? formatClock(duration) : undefined}>
          {formatClock(playing || position > 0 ? position : duration)}
        </span>
        <div
          className="voice-card-bar"
          ref={barRef}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            seekTo(event.clientX)
          }}
          onPointerMove={(event) => {
            if (event.buttons & 1) seekTo(event.clientX)
          }}
        >
          <span className="voice-card-bar-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

/**
 * Penpot: Page Switcher — 1 ⋯ 49 [50] 51 ⋯ 99: the first page, the one
 * either side of the current, the current and the last, with ⋯ standing for
 * whatever is skipped between them. A page that would be written twice is
 * written once, and a run that skips nothing carries no ⋯.
 */
function Pager({
  pages,
  current,
  onPick
}: {
  pages: number
  current: number
  onPick: (page: number) => void
}): React.JSX.Element {
  const items = useMemo(() => {
    const wanted = [0, current - 1, current, current + 1, pages - 1].filter(
      (index, at, all) => index >= 0 && index < pages && all.indexOf(index) === at
    )
    const out: Array<number | 'gap'> = []
    wanted.forEach((index, at) => {
      if (at > 0 && index - wanted[at - 1] > 1) out.push('gap')
      out.push(index)
    })
    return out
  }, [pages, current])

  return (
    <div className="voice-pager">
      {items.map((item, at) =>
        item === 'gap' ? (
          <span className="voice-page gap" key={`gap-${at}`}>
            ⋯
          </span>
        ) : (
          <button
            type="button"
            className={`voice-page${item === current ? ' current' : ''}`}
            key={item}
            onClick={() => onPick(item)}
            aria-current={item === current ? 'page' : undefined}
          >
            {item + 1}
          </button>
        )
      )}
    </div>
  )
}
