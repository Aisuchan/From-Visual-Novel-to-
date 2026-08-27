import { useEffect, useState } from 'react'
import type { GameWithStats, NewGameInput } from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import './AddGameDialog.css'

interface Props {
  /** When present the dialog edits this game instead of creating a new one. */
  game?: GameWithStats | null
  onCancel: () => void
  onSubmit: (input: NewGameInput) => void
}

export default function AddGameDialog({ game, onCancel, onSubmit }: Props): React.JSX.Element {
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
      useExeIcon,
      useShortName,
      useThumbnailAsDefault
    })
  }

  return (
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
                <div className="split-input">
                  <input
                    className="split-input-field"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="---"
                  />
                  <div className="split-input-divider" />
                  {/* Group management is deferred — the picker is inert. */}
                  <span className="split-input-button small-caret">▼</span>
                </div>
              </div>

              {/* Tag management is deferred — this row is an inert placeholder. */}
              <div className="field">
                <label className="field-label">Tag</label>
                <div className="split-input">
                  <div className="split-input-field tag-area" />
                  <div className="split-input-divider" />
                  <span className="split-input-button">ADD</span>
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
  )
}
