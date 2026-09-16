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
      .map((game) => ({ key: String(game.id), label: displayName(game) }))
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
            />
          </div>
          {/* Penpot: Search Box — 691x49, held to the block's right end. It
              narrows as it is typed, there being no button beside it. */}
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

      {/* Penpot: Voice Container — 1585x749, a grid of three columns by six
          rows filled down the columns, 20 between rows and 30 between columns,
          35 above and 50 either side */}
      <div className="voice-container" ref={containerRef}>
        {shown.map((voice) => (
          <VoiceCard
            key={voice.id}
            voice={voice}
            name={characterName(voice.characterId) || '---'}
            thumbnail={gameThumbnail(voice)}
            playing={playing === voice.id}
            onPlaying={(on) => setPlaying((was) => (on ? voice.id : was === voice.id ? null : was))}
            onContextMenu={(event) => openMenu(voice, event)}
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
  onPick
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
}): React.JSX.Element {
  return (
    <div className="voice-select" ref={anchorRef}>
      <input
        className={`voice-select-value ${className}`}
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
  playing,
  onPlaying,
  onContextMenu
}: {
  voice: Voice
  name: string
  thumbnail: string | null
  playing: boolean
  onPlaying: (on: boolean) => void
  onContextMenu: (event: React.MouseEvent) => void
}): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)

  /* Another card taking the ▶ puts this one on pause: one voice at a time is
     what the board plays. */
  useEffect(() => {
    const audio = audioRef.current
    if (!playing && audio && !audio.paused) audio.pause()
  }, [playing])

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
        <span className="voice-card-title">{voice.title}</span>
        <span className="voice-card-rule" />
        <span className="voice-card-name">{name}</span>
      </div>
      {/* Penpot: Player — 445x44: ▶, a rule, 00:00, the bar */}
      <div className="voice-card-player">
        <audio
          ref={audioRef}
          src={mediaUrl(voice.filePath)}
          preload="metadata"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
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
        <span className="voice-card-time" title={duration > 0 ? formatClock(duration) : undefined}>
          {formatClock(position)}
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
