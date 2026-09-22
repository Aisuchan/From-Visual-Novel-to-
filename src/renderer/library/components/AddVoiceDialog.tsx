import { useMemo, useRef, useState } from 'react'
import type { GameWithStats, NewVoiceInput, Voice, VoiceCharacter } from '../../../shared/db-types'
import { t } from '../../../shared/i18n'
import { useContextMenuDismiss } from '../context-menu'
import { suggestsGroup } from '../filter'
import { mediaUrl } from '../../../shared/media-url'
import { displayName } from '../sort'
import ConfirmDialog from './ConfirmDialog'
import ContextMenu from './ContextMenu'
import OptionMenu from './OptionMenu'
import './AddVoiceDialog.css'

/** The row at the head of the Character list that turns into the field a new
    name is typed into. Not a character, so it carries a word for a key. */
const ADD_CHARACTER_KEY = 'add-character'
/** The design's field is 667 wide and the list drops out of it at that width,
    6 clear of the field the way the Home board's menus are. */
const MENU_WIDTH = 667
const MENU_TOP = 54 + 6
const MENU_ROWS = 8
/** The board the dialog stands on, in design px. */
const BOARD_WIDTH = 1585
/** The Right Click Menu at two options: 10 above and below, two 42 rows, 5 between. */
const CONTEXT_MENU_WIDTH = 201
const CONTEXT_MENU_HEIGHT = 10 + 42 * 2 + 5 + 10

/** The file's own name with its extension taken off, which is what the Title
    field is filled with as a file is picked. */
function baseName(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

interface Props {
  games: GameWithStats[]
  characters: VoiceCharacter[]
  /** A voice being changed rather than added: the rows open filled with it,
      the head reads CHANGE VOICE, and what comes back is the same shape. */
  voice?: Voice
  /** The list is the shell's; every write to it is reported back up. */
  onCharactersChanged: (characters: VoiceCharacter[]) => void
  onCancel: () => void
  onSubmit: (input: NewVoiceInput) => void
}

/**
 * Penpot board "ADD VOICE" (1c7a6731-6a56-809d-8008-a18c2bcca482), 767x957 —
 * the dialog the Voice board's ADD VOICE puts up, over the board the way the
 * Add Thumbnail board's own questions stand over it. Four rows under the
 * header — Voice Path, Title, Game, Character — each a Girassol 48 name over
 * a 54-tall field, divided by 1px rules, and the cancel / ok pair at the foot.
 *
 * **Voice Path is only ever a file the runtime plays**: the field is read
 * rather than typed into, and Ref (or the field itself) opens a dialog
 * filtered to audio and the clips the gallery already takes. Picking one
 * writes the file's own name, extension off, into Title — unless Title has
 * been typed into since, in which case what was typed stands.
 *
 * **Game and Character are the Add Game dialog's own Group row twice over.**
 * The ▼ drops the whole list out of the row and typing narrows that same
 * board to the names *beginning with* what has been typed (`suggestsGroup`,
 * which is a prefix match on any name). Character's list carries
 * 「新しいキャラを追加 ＋」 at its head, which turns into the field a name is
 * typed into; a right press on a character offers 変更 — the row itself
 * becomes the field — and 削除, which asks first the way every deletion in
 * the app does. A name typed into the Character field that is no character
 * yet is added as the voice is written, being a name typed into a field
 * that holds a character's name.
 */
export default function AddVoiceDialog({
  games,
  characters,
  voice,
  onCharactersChanged,
  onCancel,
  onSubmit
}: Props): React.JSX.Element {
  /* A voice being changed opens on the file it was taken from — the app's
     own copy standing in for a row made without one. */
  const [sourcePath, setSourcePath] = useState(voice ? (voice.sourcePath ?? voice.filePath) : '')
  const [title, setTitle] = useState(voice?.title ?? '')
  /* What Title was last filled with off a file, so a second pick can tell a
     title that was typed from one it wrote itself. */
  const autoTitle = useRef('')
  const [gameText, setGameText] = useState(() => {
    const game = voice && games.find((one) => one.id === voice.gameId)
    return game ? displayName(game) : ''
  })
  const [gameMenu, setGameMenu] = useState<'none' | 'all' | 'suggest'>('none')
  const gameRowRef = useRef<HTMLDivElement | null>(null)
  const [charText, setCharText] = useState(
    () => (voice && characters.find((one) => one.id === voice.characterId)?.name) ?? ''
  )
  const [charMenu, setCharMenu] = useState<'none' | 'all' | 'suggest'>('none')
  const charRowRef = useRef<HTMLDivElement | null>(null)
  /** The row of the Character list being written into: the add row, or a
      character being renamed. */
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null)
  const [charContext, setCharContext] = useState<{
    character: VoiceCharacter
    left: number
    top: number
  } | null>(null)
  const charContextOpener = useContextMenuDismiss(charContext !== null, () => setCharContext(null))
  const [deleting, setDeleting] = useState<VoiceCharacter | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pickFile(): Promise<void> {
    const picked = await window.library.pickVoiceFile()
    if (!picked) return
    setSourcePath(picked)
    setError(null)
    const name = baseName(picked)
    setTitle((was) => (was.trim() === '' || was === autoTitle.current ? name : was))
    autoTitle.current = name
  }

  const gameOptions = useMemo(() => {
    if (gameMenu === 'none') return []
    return games
      .filter((game) => gameMenu === 'all' || suggestsGroup(displayName(game), gameText))
      .map((game) => ({
        key: String(game.id),
        label: displayName(game),
        // The game's own icon at the row's left, so the list reads by picture.
        iconUrl: game.iconPath ? mediaUrl(game.iconPath) : ''
      }))
  }, [games, gameMenu, gameText])

  const charOptions = useMemo(() => {
    if (charMenu === 'none') return []
    const rows = characters
      .filter((one) => charMenu === 'all' || suggestsGroup(one.name, charText))
      .map((one) => ({ key: String(one.id), label: one.name }))
    return charMenu === 'all'
      ? [{ key: ADD_CHARACTER_KEY, label: t('新しいキャラを追加 ＋') }, ...rows]
      : rows
  }, [characters, charMenu, charText])

  /* What the row being written into settles to. The add row makes a
     character and puts its name in the field; a rename writes the row. A
     name left empty leaves the list as it was. */
  async function commitEdit(text: string): Promise<void> {
    const key = editing?.key
    setEditing(null)
    const name = text.trim()
    if (!key || !name) return
    if (key === ADD_CHARACTER_KEY) {
      onCharactersChanged(await window.library.addVoiceCharacter(name))
      setCharText(name)
      setCharMenu('none')
      return
    }
    const id = Number(key)
    const before = characters.find((one) => one.id === id)
    onCharactersChanged(await window.library.renameVoiceCharacter(id, name))
    // The field was saying the old name; it says the new one.
    if (before && charText.trim() === before.name) setCharText(name)
  }

  /* The press itself, placed against the board the dialog stands on — in
     that board's own design pixels, the way every right-click menu in the
     app is placed against the box whose design width it knows. */
  function openCharContext(key: string, event: React.MouseEvent): void {
    const character = characters.find((one) => String(one.id) === key)
    const board = (event.currentTarget as HTMLElement).closest('.add-voice')
    if (!character || !board) return
    event.preventDefault()
    charContextOpener.current = event.currentTarget as HTMLElement
    const box = board.getBoundingClientRect()
    const scale = box.width / BOARD_WIDTH
    setCharContext({
      character,
      left: Math.min((event.clientX - box.left) / scale, BOARD_WIDTH - CONTEXT_MENU_WIDTH),
      top: Math.min((event.clientY - box.top) / scale, box.height / scale - CONTEXT_MENU_HEIGHT)
    })
  }

  async function deleteCharacter(character: VoiceCharacter): Promise<void> {
    setDeleting(null)
    onCharactersChanged(await window.library.deleteVoiceCharacter(character.id))
    if (charText.trim() === character.name) setCharText('')
  }

  async function submit(): Promise<void> {
    if (!sourcePath) {
      setError(t('ボイスのファイルを選んでください'))
      return
    }
    const game = games.find((one) => displayName(one) === gameText.trim()) ?? null
    let characterId: number | null = null
    const charName = charText.trim()
    if (charName) {
      let character = characters.find((one) => one.name === charName)
      if (!character) {
        const list = await window.library.addVoiceCharacter(charName)
        onCharactersChanged(list)
        character = list.find((one) => one.name === charName)
      }
      characterId = character?.id ?? null
    }
    onSubmit({
      gameId: game?.id ?? null,
      characterId,
      title: title.trim() || baseName(sourcePath),
      sourcePath
    })
  }

  return (
    <>
      {/* A press on the backdrop — anywhere that is not the dialog or a menu
          hanging off it — is the dialog cancelled. The target is checked
          rather than the press stopped inside the dialog, since the context
          menu stands on the backdrop too. */}
      <div
        className="dialog-backdrop add-voice-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) onCancel()
        }}
      >
        <div className="add-voice-dialog-slot">
          <div className="add-voice-dialog">
            {/* Penpot: Board — 767x78 on #2a2d31 under the same 10px inner
              stroke, "ADD VOICE" at Girassol 48 in its middle */}
            <div className="add-voice-dialog-head">{voice ? 'CHANGE VOICE' : 'ADD VOICE'}</div>

            {/* Penpot: Board — 767x752, 50 either side, the four rows divided
              by 1px rules in #B1B2B5 */}
            <div className="add-voice-dialog-body">
              {/* Penpot: Voice Path — the name over Url Box: Path Input 554 and
                Ref 103, 10 apart */}
              <div className="add-voice-row">
                <label className="add-voice-label">Voice Path</label>
                <div className="add-voice-url-box">
                  <button
                    type="button"
                    className={`add-voice-path${sourcePath ? '' : ' empty'}`}
                    onClick={() => void pickFile()}
                    title={sourcePath || t('音声・動画ファイルを選ぶ')}
                  >
                    {sourcePath || 'Path...'}
                  </button>
                  <button type="button" className="add-voice-ref" onClick={() => void pickFile()}>
                    Ref
                  </button>
                </div>
              </div>
              <div className="add-voice-rule" />

              {/* Penpot: Title — the name over Title Input, 667x54 */}
              <div className="add-voice-row">
                <label className="add-voice-label" htmlFor="add-voice-title">
                  Title
                </label>
                <input
                  id="add-voice-title"
                  className="add-voice-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Title..."
                />
              </div>
              <div className="add-voice-rule" />

              {/* Penpot: Game — the name over Selected Group 624, a 1px rule and
                Show Option 42 */}
              <div className="add-voice-row">
                <label className="add-voice-label" htmlFor="add-voice-game">
                  Game
                </label>
                <div className="add-voice-anchor" ref={gameRowRef}>
                  <div className="add-voice-select">
                    <input
                      id="add-voice-game"
                      className="add-voice-select-field"
                      value={gameText}
                      onChange={(event) => {
                        setGameText(event.target.value)
                        setGameMenu(event.target.value.trim() ? 'suggest' : 'none')
                      }}
                      onFocus={() => {
                        if (gameText.trim()) setGameMenu('suggest')
                      }}
                      onBlur={() => setGameMenu((menu) => (menu === 'suggest' ? 'none' : menu))}
                      placeholder="---"
                    />
                    <span className="add-voice-select-divider" />
                    <button
                      type="button"
                      className="add-voice-select-caret"
                      onClick={() => setGameMenu((menu) => (menu === 'all' ? 'none' : 'all'))}
                      title={t('ゲーム一覧')}
                      aria-label={t('ゲーム一覧')}
                      aria-expanded={gameMenu !== 'none'}
                    >
                      ▼
                    </button>
                  </div>
                  {gameOptions.length > 0 && (
                    <OptionMenu
                      options={gameOptions}
                      top={MENU_TOP}
                      left={0}
                      width={MENU_WIDTH}
                      maxRows={MENU_ROWS}
                      onPick={(key) => {
                        setGameMenu('none')
                        const picked = games.find((game) => String(game.id) === key)
                        if (picked) setGameText(displayName(picked))
                      }}
                      onDismiss={() => setGameMenu('none')}
                      anchorRef={gameRowRef}
                    />
                  )}
                </div>
              </div>
              <div className="add-voice-rule" />

              {/* Penpot: Character — the same row again, its list headed by the
                row that adds a character */}
              <div className="add-voice-row">
                <label className="add-voice-label" htmlFor="add-voice-character">
                  Character
                </label>
                <div className="add-voice-anchor" ref={charRowRef}>
                  <div className="add-voice-select">
                    <input
                      id="add-voice-character"
                      className="add-voice-select-field"
                      value={charText}
                      onChange={(event) => {
                        setCharText(event.target.value)
                        setCharMenu(event.target.value.trim() ? 'suggest' : 'none')
                      }}
                      onFocus={() => {
                        if (charText.trim()) setCharMenu('suggest')
                      }}
                      onBlur={() => setCharMenu((menu) => (menu === 'suggest' ? 'none' : menu))}
                      placeholder="---"
                    />
                    <span className="add-voice-select-divider" />
                    <button
                      type="button"
                      className="add-voice-select-caret"
                      onClick={() => {
                        setEditing(null)
                        setCharMenu((menu) => (menu === 'all' ? 'none' : 'all'))
                      }}
                      title={t('キャラクター一覧')}
                      aria-label={t('キャラクター一覧')}
                      aria-expanded={charMenu !== 'none'}
                    >
                      ▼
                    </button>
                  </div>
                  {charOptions.length > 0 && (
                    <OptionMenu
                      options={charOptions}
                      top={MENU_TOP}
                      left={0}
                      width={MENU_WIDTH}
                      /* Eight rows stand, the row that adds one among them,
                         and the rest are scrolled to. */
                      maxRows={MENU_ROWS}
                      onPick={(key) => {
                        if (key === ADD_CHARACTER_KEY) {
                          setEditing({ key, value: '' })
                          return
                        }
                        setCharMenu('none')
                        const picked = characters.find((one) => String(one.id) === key)
                        if (picked) setCharText(picked.name)
                      }}
                      onDismiss={() => {
                        setEditing(null)
                        setCharMenu('none')
                      }}
                      onRowContext={openCharContext}
                      editing={
                        editing
                          ? {
                              key: editing.key,
                              value: editing.value,
                              onCommit: (text) => void commitEdit(text),
                              onCancel: () => setEditing(null)
                            }
                          : undefined
                      }
                      anchorRef={charRowRef}
                    />
                  )}
                </div>
              </div>
              <div className="add-voice-rule" />

              {/* Not in the design: what OK could not do, said under the rows
                the way the Add Game dialog says it. */}
              {error && <div className="add-voice-error">{error}</div>}
            </div>

            {/* Penpot: Cancel OK Button — 757x117, the pair 30 apart at the
              right, 20 above and 35 below */}
            <div className="add-voice-dialog-actions">
              <button type="button" className="add-voice-cancel" onClick={onCancel}>
                cancel
              </button>
              <button
                type="button"
                className="add-voice-ok"
                onClick={() => void submit()}
                disabled={sourcePath === ''}
              >
                ok
              </button>
            </div>
          </div>
        </div>

        {/* The two things a character in the list can be made to do, on the
            same plate and the same rule every other right press follows. */}
        {charContext && (
          <ContextMenu
            style={{
              left: `${charContext.left}px`,
              top: `${charContext.top}px`
            }}
            items={[
              {
                label: t('変更'),
                onSelect: () => {
                  /* The row takes the caret from the field, which puts a
                     suggestion list away; the whole list is what stays. */
                  setCharMenu('all')
                  setEditing({
                    key: String(charContext.character.id),
                    value: charContext.character.name
                  })
                  setCharContext(null)
                }
              },
              {
                label: t('削除'),
                danger: true,
                onSelect: () => {
                  setDeleting(charContext.character)
                  setCharContext(null)
                }
              }
            ]}
          />
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title="delete character"
          message={t('「{0}」を削除しますか？', deleting.name)}
          note={t('このキャラクターのボイスはキャラクターなしになります。')}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void deleteCharacter(deleting)}
        />
      )}
    </>
  )
}
