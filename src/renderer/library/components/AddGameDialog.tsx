import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseErogamescape, parseVndb, referenceUrl } from '../reference'
import type {
  GameWithStats,
  Group,
  Language,
  NewGameInput,
  NewGroupInput,
  Tag,
  VndbReleaseLanguage
} from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import { suggestsGroup } from '../filter'
import AddGameMore from './AddGameMore'
import NewGroupSetting from './NewGroupSetting'
import OptionMenu from './OptionMenu'
import TagChip from './TagChip'
import './AddGameDialog.css'
import { getLanguage, t } from '../../../shared/i18n'

interface Props {
  /** When present the dialog edits this game instead of creating a new one. */
  game?: GameWithStats | null
  /** The groups the Group row's menu offers, as the side panel's does. */
  groups: Group[]
  /** A group made from this dialog's own New Group Setting board. */
  onGroupsChanged: (groups: Group[]) => void
  /** The tag vocabulary, which is what names the game's own tags. */
  tags: Tag[]
  /* The Setting board's own row: which language's release the VN Database's
     date is read off. It is the shell's, like every other setting, and reaches
     the dialog as the one thing about the settings this row needs. */
  vndbReleaseLanguage: VndbReleaseLanguage
  /** Whether the advanced panel stands beside the dialog, and which currency
      its price field carries. Both are the shell's settings. */
  addGameMore: boolean
  language: Language
  onCancel: () => void
  onSubmit: (input: NewGameInput) => void
  /* A right press on one of the rows the group list drops. It is the shell's
     to answer: the list is the shell's, and so is the board that edits one. */
  onGroupContext?: (key: string, event: React.MouseEvent) => void
}

/** The key the add row answers to, which is no group's id — as in the panel. */
const ADD_GROUP_KEY = 'add-group'
/* Penpot: Group — the 426x39 row, and the menu drops out of it 5px below.
   The design's own list is five long; eight groups stand before it scrolls,
   as they do in the panel, and the add row stands over them. */
/* Penpot's Top Right, which the row fills — and what the list is until the row
   has been measured. **The row is not that wide here.** The dialog's 10px stroke
   is an inner one in Penpot and a CSS `border` in this app, so the box the
   children are laid out in is 850 rather than the design's 870 and every figure
   inside the Top Container comes out 20 short: the row is 406. Written down, the
   design's 426 put the list 20px past the row's right edge and it was cut off
   there, so the list takes the row's own `offsetWidth` instead — unzoomed CSS
   pixels, which are design pixels, so nothing has to be scaled. */
const GROUP_MENU_WIDTH = 426
const GROUP_MENU_TOP = 44
const GROUP_MENU_ROWS = 8

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
  vndbReleaseLanguage,
  addGameMore,
  language,
  onCancel,
  onSubmit,
  onGroupContext
}: Props): React.JSX.Element {
  const editing = !!game

  const [title, setTitle] = useState(game?.title ?? '')
  const [shortName, setShortName] = useState(game?.shortName ?? '')
  const [groupName, setGroupName] = useState(game?.groupName ?? '')
  const [exePath, setExePath] = useState(game?.exePath ?? '')
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(game?.thumbnailPath ?? null)
  const [iconPath, setIconPath] = useState<string | null>(game?.iconPath ?? null)
  const [useExeIcon, setUseExeIcon] = useState(game?.useExeIcon ?? true)
  /* **A game being registered opens with all three of them on.** They are what
     the dialog does for you rather than choices about the game itself — the
     icon off the executable, the short name where the full one will not fit,
     the thumbnail carried over — so a game added without a thought given to
     them is filed the way the app files one. A game being edited keeps
     whatever it was stored with. */
  const [useShortName, setUseShortName] = useState(game?.useShortName ?? true)
  const [useThumbnailAsDefault, setUseThumbnailAsDefault] = useState(
    game?.useThumbnailAsDefault ?? true
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
  /* How wide the group list is: the row's own width rather than the design's
     figure — see `GROUP_MENU_WIDTH`. Measured as the list opens, since the
     dialog can be resized under it by the window. */
  const [groupMenuWidth, setGroupMenuWidth] = useState(GROUP_MENU_WIDTH)
  /* **The Reference row.** The URL is the row's own state; what the site said
     is kept beside it, so what is written when OK is pressed is what the row
     actually read rather than whatever the fields have been edited to since.
     `reading` is what the button says while the one request is in flight, and
     is also what stops a second press from making a second one. */
  const [referenceUrlText, setReferenceUrlText] = useState(game?.referenceUrl ?? '')
  const [reading, setReading] = useState(false)
  const [referenceError, setReferenceError] = useState<string | null>(null)
  /* The advanced panel's four fields. Brand Name and Release Date are filled
     by the Reference row and stay editable; Purchase Date and Purchase Price
     are the player's own. They are held whether or not the panel is shown, so
     a game edited with the panel off keeps what it had. */
  const [brand, setBrand] = useState(game?.brand ?? '')
  const [releaseDate, setReleaseDate] = useState(game?.releaseDate ?? '')
  const [purchaseDate, setPurchaseDate] = useState(game?.purchaseDate ?? '')
  const [purchasePrice, setPurchasePrice] = useState(
    game?.purchasePrice != null ? String(game.purchasePrice) : ''
  )
  const [listPrice, setListPrice] = useState(
    game?.listPrice != null ? String(game.listPrice) : ''
  )
  /* What the Reference row read that the panel does not hold: the brand and
     the release date go into their own fields above, so what is left here is
     the release language the date is, and the two scores. */
  const [reference, setReference] = useState<{
    releaseLanguage: VndbReleaseLanguage | null
    medianScore: number | null
    averageScore: number | null
  } | null>(null)

  useLayoutEffect(() => {
    const row = groupRowRef.current
    if (row && row.offsetWidth > 0) setGroupMenuWidth(row.offsetWidth)
  }, [groupMenu])
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
    const rows = groups
      .filter((group) => groupMenu === 'all' || suggestsGroup(group.name, groupName))
      .map((group) => ({
        key: String(group.id),
        label: group.name,
        color: group.color
      }))
    return groupMenu === 'all'
      ? [{ key: ADD_GROUP_KEY, label: t('グループを追加 ＋') }, ...rows]
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

  /* What the button is dead until: a URL that is one of the pages this can
     read. The same test the main process makes before it opens anything, so the
     row can say whether it will work without asking the site. */
  const readable = referenceUrl(referenceUrlText)
  const canRead = !reading && readable !== null

  /**
   * **One press, one read.** The page is fetched, what it says is read out of
   * it here, and the fields it can fill are filled — the title, the picture,
   * and the three figures the library sorts on. The brand joins the Tag row as
   * a chip: it is a thing a library is filed by and the row already filters on
   * one, and standing there it can be taken off again before OK.
   *
   * **What is already typed is left alone.** The title is only written into an
   * empty field and the picture only into an empty slot: a person who has named
   * the game themselves has said what they want it called, and a row read
   * afterwards is a source of what they did *not* fill in.
   */
  async function readReference(): Promise<void> {
    if (!canRead || !readable) return
    const { url, site } = readable
    setReading(true)
    setReferenceError(null)
    try {
      const html = await window.library.fetchReferencePage(url)
      /* Two sites, two shapes of page, one row: which parser reads it follows
         from the address, which is what said the button could be pressed. */
      const entry =
        site === 'vndb' ? parseVndb(html, vndbReleaseLanguage) : parseErogamescape(html)

      if (entry.title && !title.trim()) setTitle(entry.title)
      /* **The brand goes to both places, because it is two things.** It is a
         fact about the game, which the Game Info board's BRAND row states; and
         it is something a library is filed by, which is what a tag is. Put on
         the row it can be searched on and taken off again before OK, and the
         row already drops a name it is carrying. */
      if (entry.brand) {
        const name = entry.brand
        setChips((was) =>
          was.some((chip) => chip.name.toLowerCase() === name.toLowerCase())
            ? was
            : [...was, { id: nextChipId.current++, name }]
        )
        // And into the advanced panel's Brand Name field, where the row is
        // what fills it — left alone if it already says something.
        if (!brand.trim()) setBrand(entry.brand)
      }
      // The Release Date field, filled the same way, left alone if typed into.
      if (entry.releaseDate && !releaseDate.trim()) setReleaseDate(entry.releaseDate)
      setReference({
        /* Which of the page's per-language releases answered — the row's own
           choice, or the Japanese one it fell back to. ErogameScape lists one
           date and hands back nothing here, which is what leaves its games
           without the mark. */
        releaseLanguage: entry.releaseLanguage ?? null,
        medianScore: entry.medianScore,
        averageScore: entry.averageScore
      })

      /* **The picture is the second and last request, and its own to fail.**
         It is on whatever shop's host the page happens to point at, so it can
         be gone, or refused, when everything else about the read went through.
         Caught here, the title, the brand and the figures stay where they have
         been put and the row says the one thing that did not arrive. */
      if (entry.imageSrc && !thumbnailPath) {
        try {
          setThumbnailPath(await window.library.fetchReferenceImage(entry.imageSrc, url))
        } catch (error) {
          setReferenceError(
            t('画像だけ取得できませんでした（{0}）', error instanceof Error ? error.message : '')
          )
        }
      }
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : String(error))
    } finally {
      setReading(false)
    }
  }

  function submit(): void {
    if (!title.trim()) {
      setError(t('ゲーム名を入力してください'))
      return
    }
    if (!exePath.trim()) {
      setError(t('実行ファイルを選択してください'))
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
      useThumbnailAsDefault,
      /* Null where the row was never pressed, which is what leaves a game
         registered by hand with whatever it already had. The URL is the one
         exception: it is the row's own field and is written as it stands. */
      /* Brand and Release Date are the panel's own fields now — filled by the
         Reference row, then whatever they were edited to. Written as they
         stand rather than only where the row was pressed, so a value typed in
         by hand is kept; null where empty, which on update clears the column
         (the panel's fields are not coalesced). */
      releaseDate: releaseDate.trim() || null,
      releaseLanguage: reference?.releaseLanguage ?? null,
      medianScore: reference?.medianScore ?? null,
      averageScore: reference?.averageScore ?? null,
      brand: brand.trim() || null,
      purchaseDate: purchaseDate.trim() || null,
      purchasePrice: purchasePrice.trim() === '' ? null : Number(purchasePrice),
      listPrice: listPrice.trim() === '' ? null : Number(listPrice),
      referenceUrl: referenceUrlText.trim() || null
    })
  }

  return (
    <>
      <div className="dialog-backdrop" onClick={onCancel}>
        {/* Penpot: Add Game More — the advanced panel, to the left of the
            dialog and flush against it, shown only while the Setting board's
            own row is on. */}
        {addGameMore && (
          <AddGameMore
            language={language}
            brand={brand}
            releaseDate={releaseDate}
            purchaseDate={purchaseDate}
            purchasePrice={purchasePrice}
            listPrice={listPrice}
            onBrand={setBrand}
            onReleaseDate={setReleaseDate}
            onPurchaseDate={setPurchaseDate}
            onPurchasePrice={setPurchasePrice}
            onListPrice={setListPrice}
          />
        )}
        <div className="add-game-dialog" onClick={(e) => e.stopPropagation()}>
          {/* Penpot: Top Latter — 870x61, fill #2a2d31, stroke #657786 5px inner.
              "change information" is the design's variant of this text shape. */}
          <div className="dialog-top-latter">{editing ? 'change info' : 'add game'}</div>

          {/* Penpot: Reference — 870x157, 15px/36px padding, 15px row gap */}
          <div className="dialog-reference">
            <label className="field-label">
              {t('erogamescape(批評空間)/VN DataBase を参照')}
            </label>

            <div className="url-box">
              <input
                className="url-input"
                placeholder="URL..."
                value={referenceUrlText}
                onChange={(event) => {
                  setReferenceUrlText(event.target.value)
                  setReferenceError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canRead) void readReference()
                }}
              />
              {/* **Nothing is fetched until this is pressed.** Typing a URL
                  asks the site for nothing, and the button is dead until what
                  has been typed is a page this can read — so a half-typed
                  address is never opened. */}
              <button
                className="url-button"
                onClick={() => void readReference()}
                disabled={!canRead}
              >
                {reading ? t('取得中') : t('送信')}
              </button>
            </div>

            {referenceError !== null && (
              <p className="url-error">{referenceError}</p>
            )}

            <label className="setting-row">
              <input
                type="checkbox"
                checked={useThumbnailAsDefault}
                onChange={(e) => setUseThumbnailAsDefault(e.target.checked)}
              />
              <span className="setting-text">{t('サムネイルを使用')}</span>
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
                  {/* Penpot writes this over two lines with the break in the
                      middle of the sentence; where the other language breaks it
                      is the other language's, so the run carries its own. */}
                  <span className="setting-text small">
                    {t('GAME NAMEを表示するスペースが\n足りない場合、SHORT NAMEを代わりに表示')
                      .split('\n')
                      .map((line, index) => (
                        <span key={index}>
                          {index > 0 && <br />}
                          {line}
                        </span>
                      ))}
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
                          title={t('グループを外す')}
                          aria-label={t('グループを外す')}
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      )}
                      <div className="split-input-divider" />
                      {/* Penpot: Show Option — drops the Menu below the row. */}
                      <button
                        className="split-input-button small-caret"
                        onClick={() => setGroupMenu((menu) => (menu === 'all' ? 'none' : 'all'))}
                        title={t('グループ一覧')}
                        aria-label={t('グループ一覧')}
                        aria-expanded={groupMenu !== 'none'}
                      >
                        ▼
                      </button>
                    </div>

                    {groupOptions.length > 0 && (
                      <OptionMenu
                        options={groupOptions}
                        onRowContext={onGroupContext}
                        top={GROUP_MENU_TOP}
                        left={0}
                        width={groupMenuWidth}
                        /* The groups are what the count is of; the row that
                           adds one is not one of them, and the suggestions
                           leave it off entirely. */
                        maxRows={
                          GROUP_MENU_ROWS + (groupOptions[0]?.key === ADD_GROUP_KEY ? 1 : 0)
                        }
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
                    <button className="split-input-button" onClick={addChip} title={t('タグを追加')}>
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
            <label className="field-label">{t('実行ファイルの場所')}</label>

            <div className="url-box">
              <input className="url-input" value={exePath} readOnly placeholder="Path..." />
              <button
                className={`url-button ref${getLanguage() === 'en' ? ' wide' : ''}`}
                onClick={pickExe}
              >
                {t('参照')}
              </button>
            </div>

            <label className="setting-row">
              <input
                type="checkbox"
                checked={useExeIcon}
                onChange={(e) => setUseExeIcon(e.target.checked)}
              />
              <span className="setting-text">{t('実行ファイルのアイコンを使用')}</span>
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
