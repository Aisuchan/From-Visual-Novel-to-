import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  GameWithStats,
  Group,
  NewGameInput,
  NewGroupInput,
  Tag
} from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import NewGroupSetting from './NewGroupSetting'
import OptionMenu from './OptionMenu'
import TagChip from './TagChip'
import './AddGameDialog.css'

interface Props {
  /** When present the dialog edits this game instead of creating a new one. */
  game?: GameWithStats | null
  /** The groups the Group row's menu offers, as the side panel's does. */
  groups: Group[]
  /** A group made from this dialog's own New Group Setting board. */
  onGroupsChanged: (groups: Group[]) => void
  /** The tag vocabulary, which is what names the game's own tags. */
  tags: Tag[]
  onCancel: () => void
  onSubmit: (input: NewGameInput) => void
}

/** The key the add row answers to, which is no group's id — as in the panel. */
const ADD_GROUP_KEY = 'add-group'
/* Penpot: Group — the 426x39 row, and the menu drops out of it 5px below.
   The design's own list is five long, and the add row stands over it. */
const GROUP_MENU_WIDTH = 426
const GROUP_MENU_TOP = 44
const GROUP_MENU_ROWS = 6

/** One chip on the Tag row. The id is the row's own; nothing stores it. */
interface Chip {
  id: number
  name: string
}

export default function AddGameDialog({
  game,
  groups,
  onGroupsChanged,
  tags,
  onCancel,
  onSubmit
}: Props): React.JSX.Element {
  const editing = !!game

  const [title, setTitle] = useState(game?.title ?? '')
  const [shortName, setShortName] = useState(game?.shortName ?? '')
  const [groupName, setGroupName] = useState(game?.groupName ?? '')
  const [exePath, setExePath] = useState(game?.exePath ?? '')
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(game?.thumbnailPath ?? null)
  const [iconPath, setIconPath] = useState<string | null>(game?.iconPath ?? null)
  const [useExeIcon, setUseExeIcon] = useState(game?.useExeIcon ?? true)
  const [useShortName, setUseShortName] = useState(game?.useShortName ?? false)
  const [useThumbnailAsDefault, setUseThumbnailAsDefault] = useState(
    game?.useThumbnailAsDefault ?? false
  )
  const [error, setError] = useState<string | null>(null)
  /* The Group row, worked the way the side panel's Select Group is: the button
     drops the whole list out of the row, and typing in the field puts the same
     board up as its suggestions — the list narrowed to what has been typed and
     without the row that adds to it. */
  const [groupMenu, setGroupMenu] = useState<'none' | 'all' | 'suggest'>('none')
  const [showNewGroup, setShowNewGroup] = useState(false)
  /* The Tag row's chips: this game's tags, by name. They are the panel's own
     chips, and they stay the dialog's until OK — a cancelled dialog must not
     leave a tag behind — so what is stored is a name, and the vocabulary is
     resolved against in the main process when the game is written. */
  const nextChipId = useRef(1)
  /* A game carries its tags by id and the row is named, so the vocabulary is
     what puts the names back into it. It is read at the mount rather than
     fetched: an OK pressed before the names had arrived would have written the
     game's tags away. */
  const [chips, setChips] = useState<Chip[]>(() => {
    if (!game) return []
    const named = new Map(tags.map((tag) => [tag.id, tag.name]))
    return game.tagIds
      .map((id) => named.get(id) ?? '')
      .filter((name) => name !== '')
      .map((name) => ({ id: nextChipId.current++, name }))
  })
  const [editingChip, setEditingChip] = useState<number | null>(null)
  const groupRowRef = useRef<HTMLDivElement | null>(null)
  const tagAreaRef = useRef<HTMLDivElement | null>(null)
  const chipCount = useRef(chips.length)

  /* The row runs off the right rather than wrapping, so a chip added past the
     end has to be scrolled to — it is the one about to take the caret. Only a
     chip that has just arrived does this: a game opened with a row already too
     long for the field should show its start, not its end. */
  useEffect(() => {
    const grew = chips.length > chipCount.current
    chipCount.current = chips.length
    const el = tagAreaRef.current
    if (grew && el) el.scrollLeft = el.scrollWidth
  }, [chips.length])

  /* The row carries no scrollbar, so the wheel is the whole of how it moves.
     A vertical wheel over a box that only scrolls across does nothing in
     Chromium, and left alone it would scroll the dialog behind instead — so
     the delta is turned sideways here and the event stopped. React's own
     `onWheel` is registered passive and cannot stop it, hence the native
     listener. */
  useEffect(() => {
    const el = tagAreaRef.current
    if (!el) return
    const onWheel = (event: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      if (delta === 0) return
      event.preventDefault()
      // Line and page deltas, which some mice report, in pixels.
      const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1
      el.scrollLeft += delta * scale
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // With "use the executable file icon" ticked, the icon slot previews (and on
  // save stores) the icon pulled straight out of the chosen executable.
  useEffect(() => {
    if (!useExeIcon || !exePath) return
    let cancelled = false
    window.library.extractExeIcon(exePath).then((iconFile) => {
      if (!cancelled && iconFile) setIconPath(iconFile)
    })
    return () => {
      cancelled = true
    }
  }, [useExeIcon, exePath])

  /* The rows the menu shows: the groups, each in its own colour, under the row
     that adds one — which belongs to the whole list rather than to a search, so
     the suggestions leave it off. An empty list is what keeps a closed menu
     closed, so nothing else decides whether the board is up. */
  const groupOptions = useMemo(() => {
    if (groupMenu === 'none') return []
    const typed = groupName.trim().toLowerCase()
    const rows = groups
      .filter((group) => groupMenu === 'all' || group.name.toLowerCase().includes(typed))
      .map((group) => ({
        key: String(group.id),
        label: group.name,
        color: group.color
      }))
    return groupMenu === 'all'
      ? [{ key: ADD_GROUP_KEY, label: 'グループを追加 ＋' }, ...rows]
      : rows
  }, [groups, groupMenu, groupName])

  async function addGroup(input: NewGroupInput): Promise<void> {
    onGroupsChanged(await window.library.addGroup(input))
    setShowNewGroup(false)
    // The board was opened from this row, so what it made is what the row wants.
    setGroupName(input.name.trim())
  }

  /** ADD puts out a blank chip, which is the one that takes the caret. */
  function addChip(): void {
    const id = nextChipId.current++
    setChips((list) => [...list, { id, name: '' }])
    setEditingChip(id)
  }

  /* The name a chip was left holding. Nothing in it takes the chip away, and so
     does a name the row already carries — one tag is one condition on a game. */
  function commitChip(id: number, name: string): void {
    const trimmed = name.trim()
    setEditingChip((current) => (current === id ? null : current))
    setChips((list) => {
      if (trimmed === '' || list.some((chip) => chip.id !== id && chip.name === trimmed)) {
        return list.filter((chip) => chip.id !== id)
      }
      return list.map((chip) => (chip.id === id ? { ...chip, name: trimmed } : chip))
    })
  }

  async function pickExe(): Promise<void> {
    const result = await window.library.pickExecutable()
    if (result) setExePath(result)
  }

  async function pickThumbnail(): Promise<void> {
    const result = await window.library.pickImage()
    if (result) setThumbnailPath(result)
  }

  async function pickIcon(): Promise<void> {
    const result = await window.library.pickImage()
    if (result) setIconPath(result)
  }

  function submit(): void {
    if (!title.trim()) {
      setError('ゲーム名を入力してください')
      return
    }
    if (!exePath.trim()) {
      setError('実行ファイルを選択してください')
      return
    }
    onSubmit({
      title: title.trim(),
      shortName: shortName.trim() || null,
      thumbnailPath,
      iconPath,
      exePath,
      groupName: groupName.trim() || null,
      tagNames: chips.map((chip) => chip.name).filter((name) => name !== ''),
      useExeIcon,
      useShortName,
      useThumbnailAsDefault
    })
  }

  return (
    <>
      <div className="dialog-backdrop" onClick={onCancel}>
        <div className="add-game-dialog" onClick={(e) => e.stopPropagation()}>
          {/* Penpot: Top Latter — 870x61, fill #2a2d31, stroke #657786 5px inner.
              "change information" is the design's variant of this text shape. */}
          <div className="dialog-top-latter">{editing ? 'change info' : 'add game'}</div>

          {/* Penpot: Reference — 870x157, 15px/36px padding, 15px row gap */}
          <div className="dialog-reference">
            <label className="field-label">Reference ErogeScape / VN DataBase</label>

            <div className="url-box">
              <input className="url-input" placeholder="URL..." disabled />
              <button className="url-button" disabled>
                SUBMIT
              </button>
            </div>

            <label className="setting-row">
              <input
                type="checkbox"
                checked={useThumbnailAsDefault}
                onChange={(e) => setUseThumbnailAsDefault(e.target.checked)}
              />
              <span className="setting-text">Use game thumbnail as default</span>
            </label>
          </div>

          <div className="dialog-border" />

          {/* Penpot: Top Container — 870x483, 36px side padding */}
          <div className="dialog-top-container">
            {/* Penpot: Images Preview — 311 wide */}
            <div className="images-preview">
              <span className="field-label">Preview / Change</span>

              <div className="images">
                <button className="image-slot" onClick={pickThumbnail}>
                  <span className="thumbnail-image">
                    {thumbnailPath ? <img src={mediaUrl(thumbnailPath)} alt="thumbnail" /> : null}
                  </span>
                  <span className="image-caption">Thumbnail</span>
                </button>

                <button className="image-slot" onClick={pickIcon}>
                  <span className="icon-image">
                    {iconPath ? <img src={mediaUrl(iconPath)} alt="icon" /> : null}
                  </span>
                  <span className="image-caption">Icon</span>
                </button>
              </div>
            </div>

            {/* Penpot: Rectangle — 1x483, #B1B2B5, 30px side margins */}
            <div className="column-divider" />

            {/* Penpot: Top Right — 426 wide, 15px row gap */}
            <div className="top-right">
              <div className="name-container">
                <div className="field">
                  <label className="field-label">Game Name</label>
                  <input
                    className="field-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Name..."
                  />
                </div>

                <div className="field">
                  <label className="field-label">Short Name</label>
                  <input
                    className="field-input"
                    value={shortName}
                    onChange={(e) => setShortName(e.target.value)}
                    placeholder="Short Name..."
                  />
                </div>

                <label className="setting-row centered">
                  <input
                    type="checkbox"
                    checked={useShortName}
                    onChange={(e) => setUseShortName(e.target.checked)}
                  />
                  <span className="setting-text small">
                    if there is not enoght space to display the name,
                    <br />
                    short name will be displayed instead
                  </span>
                </label>
              </div>

              <div className="field-border" />

              <div className="name-container">
                <div className="field">
                  <label className="field-label">Group</label>
                  {/* The menu hangs off this row, so it is what the row is
                      measured from and what a click inside must not dismiss. */}
                  <div className="split-anchor" ref={groupRowRef}>
                    <div className="split-input">
                      <input
                        className="split-input-field"
                        value={groupName}
                        onChange={(e) => {
                          setGroupName(e.target.value)
                          setGroupMenu(e.target.value.trim() ? 'suggest' : 'none')
                        }}
                        onFocus={() => {
                          if (groupName.trim()) setGroupMenu('suggest')
                        }}
                        onBlur={() => setGroupMenu((menu) => (menu === 'suggest' ? 'none' : menu))}
                        placeholder="---"
                      />
                      {/* Not in the design: the same ✕ the side panel's field
                          carries, so a group can be let go of in one click. */}
                      {groupName && (
                        <button
                          className="split-input-clear"
                          onClick={() => {
                            setGroupName('')
                            setGroupMenu('none')
                          }}
                          title="グループを外す"
                          aria-label="グループを外す"
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      )}
                      <div className="split-input-divider" />
                      {/* Penpot: Show Option — drops the Menu below the row. */}
                      <button
                        className="split-input-button small-caret"
                        onClick={() => setGroupMenu((menu) => (menu === 'all' ? 'none' : 'all'))}
                        title="グループ一覧"
                        aria-label="グループ一覧"
                        aria-expanded={groupMenu !== 'none'}
                      >
                        ▼
                      </button>
                    </div>

                    {groupOptions.length > 0 && (
                      <OptionMenu
                        options={groupOptions}
                        top={GROUP_MENU_TOP}
                        left={0}
                        width={GROUP_MENU_WIDTH}
                        maxRows={GROUP_MENU_ROWS}
                        onPick={(key) => {
                          setGroupMenu('none')
                          if (key === ADD_GROUP_KEY) {
                            setShowNewGroup(true)
                            return
                          }
                          const picked = groups.find((group) => String(group.id) === key)
                          if (picked) setGroupName(picked.name)
                        }}
                        onDismiss={() => setGroupMenu('none')}
                        anchorRef={groupRowRef}
                      />
                    )}
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">Tag</label>
                  {/* The chips are the side panel's own, in the field the design
                      leaves blank: ADD puts out a fresh one, it is named in
                      place, and its ✕ takes it off the game again. The row grows
                      onto another line rather than running out of the column. */}
                  <div className="split-input tags">
                    <div className="split-input-field tag-area" ref={tagAreaRef}>
                      {chips.map((chip) => (
                        <TagChip
                          key={chip.id}
                          name={chip.name}
                          editing={chip.id === editingChip}
                          onCommit={(name) => commitChip(chip.id, name)}
                          onDelete={() =>
                            setChips((list) => list.filter((row) => row.id !== chip.id))
                          }
                        />
                      ))}
                    </div>
                    <div className="split-input-divider" />
                    <button className="split-input-button" onClick={addChip} title="タグを追加">
                      ADD
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="dialog-border" />

          {/* Penpot: Reference (bottom) — 870x127, 36px side padding */}
          <div className="dialog-reference bottom">
            <label className="field-label">Location of the executable</label>

            <div className="url-box">
              <input className="url-input" value={exePath} readOnly placeholder="Path..." />
              <button className="url-button ref" onClick={pickExe}>
                REF
              </button>
            </div>

            <label className="setting-row">
              <input
                type="checkbox"
                checked={useExeIcon}
                onChange={(e) => setUseExeIcon(e.target.checked)}
              />
              <span className="setting-text">Use the executable file icon</span>
            </label>
          </div>

          {error && <p className="dialog-error">{error}</p>}

          {/* Penpot: Cancel OK Button — 850x88, 20px padding, 30px gap, right aligned */}
          <div className="dialog-actions">
            <button className="cancel-button" onClick={onCancel}>
              cancel
            </button>
            <button className="ok-button" onClick={submit}>
              ok
            </button>
          </div>
        </div>
      </div>

      {/* Penpot: New Group Setting — the same board the side panel's add row
          puts up, over this dialog rather than beside it. */}
      {showNewGroup && (
        <NewGroupSetting onCancel={() => setShowNewGroup(false)} onSubmit={addGroup} />
      )}
    </>
  )
}
