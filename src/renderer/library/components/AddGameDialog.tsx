import { useState } from 'react'
import type { NewGameInput } from '../../../shared/db-types'
import './AddGameDialog.css'

interface Props {
  onCancel: () => void
  onSubmit: (input: NewGameInput) => void
}

export default function AddGameDialog({ onCancel, onSubmit }: Props): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [shortName, setShortName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [exePath, setExePath] = useState('')
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(null)
  const [iconPath, setIconPath] = useState<string | null>(null)
  const [useExeIcon, setUseExeIcon] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      useExeIcon
    })
  }

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="add-game-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">ADD GAME</h2>

        <div className="dialog-body">
          <div className="dialog-column">
            <label className="field-label">Preview / Change</label>
            <button className="thumb-picker" onClick={pickThumbnail}>
              {thumbnailPath ? (
                <img src={`file://${thumbnailPath}`} alt="thumbnail" />
              ) : (
                <span>Thumbnail</span>
              )}
            </button>
            <button className="icon-picker" onClick={pickIcon}>
              {iconPath ? <img src={`file://${iconPath}`} alt="icon" /> : <span>Icon</span>}
            </button>
          </div>

          <div className="dialog-column wide">
            <label className="field-label">Game Name</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name..." />

            <label className="field-label">Short Name</label>
            <input
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="Short Name..."
            />

            <label className="field-label">Group</label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="---"
            />
          </div>
        </div>

        <hr />

        <label className="field-label">Location of the executable</label>
        <div className="exe-row">
          <input value={exePath} readOnly placeholder="Path..." />
          <button onClick={pickExe}>REF</button>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={useExeIcon}
            onChange={(e) => setUseExeIcon(e.target.checked)}
          />
          Use the executable file icon
        </label>

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            CANCEL
          </button>
          <button className="ok-button" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
