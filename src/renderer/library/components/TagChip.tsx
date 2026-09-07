import { useEffect, useRef, useState } from 'react'
import './TagChip.css'
import { t } from '../../../shared/i18n'

interface Props {
  name: string
  /** The chip Add Tag has just put out, which opens with the caret in it. */
  editing?: boolean
  /** The name as it stands when the edit ends. Empty removes the chip. */
  onCommit?: (name: string) => void
  /** Left out where the chip only says what a game is filed under; the ✕ is
      drawn only for a row that can be taken apart. */
  onDelete?: () => void
}

/**
 * One tag in the row under the search options. Not in the Penpot design, which
 * draws the Add Tag button and nothing it makes: the chip is the app's own —
 * the row's own 40px tall, rounded right off, #222326 under #657786, with a ✕
 * inside its right end.
 *
 * A chip is written in as it is made, and **a settled one is opened again by
 * double-clicking its name** — the ✕ takes the whole chip away, so without that
 * a name with a letter wrong had to be thrown out and typed again. Which chip
 * the row has just put out is the row's to say (`editing`); reopening one is
 * the chip's own business, so it is held here. A chip that cannot be committed
 * at all — the Game board's, which only say what a game is filed under — is not
 * opened by a double-click either.
 *
 * A chip is as wide as what is written in it, which an input cannot do by
 * itself, so while it is being written the width comes from a copy of the text
 * laid out in the same face with the input over it.
 */
export default function TagChip({
  name,
  editing = false,
  onCommit,
  onDelete
}: Props): React.JSX.Element {
  const [value, setValue] = useState(name)
  /** Set by a double-click on a settled chip; the row knows nothing about it. */
  const [reopened, setReopened] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /* Escape restores the name and blurs, and the blur is what commits — but it
     reads the value the field was rendered with, which is still what had been
     typed. So the cancel is flagged rather than written into the value, and the
     blur below settles on the name the chip came in with. */
  const cancelled = useRef(false)

  const open = editing || reopened
  const renamable = onCommit !== undefined

  // A rename that came from anywhere else wins back while this one is idle.
  useEffect(() => setValue(name), [name])

  useEffect(() => {
    if (!open) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    // A chip opened again is opened to be renamed: the name it has is the
    // thing being replaced, so it is taken. A new chip is empty either way.
    input.select()
  }, [open])

  /** Ends the edit, whichever way it was opened. */
  function settle(next: string): void {
    setReopened(false)
    onCommit?.(next)
  }

  return (
    <span className={`tag-chip ${onDelete ? '' : 'static'} ${renamable ? 'renamable' : ''}`}>
      {open ? (
        <span className="tag-chip-edit">
          {/* The sizer is what the chip measures; it is never seen. */}
          <span className="tag-chip-sizer" aria-hidden="true">
            {value}
          </span>
          <input
            className="tag-chip-input"
            ref={inputRef}
            value={value}
            maxLength={30}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (cancelled.current) {
                cancelled.current = false
                setValue(name)
                // The name it came in with: a rename undone, and a chip that
                // never had one taken off the row the way an empty one is.
                settle(name)
                return
              }
              settle(value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                cancelled.current = true
                e.currentTarget.blur()
              }
            }}
            aria-label={t('タグ名')}
          />
        </span>
      ) : (
        <span
          className="tag-chip-name"
          onDoubleClick={renamable ? () => setReopened(true) : undefined}
          title={renamable ? t('ダブルクリックで名前を変更') : undefined}
        >
          {name}
        </span>
      )}

      {onDelete && (
        <button
          className="tag-chip-remove"
          /* A press here must not blur the field first: that would settle the
             name and this click would then be deleting a chip that had already
             gone one way or another. */
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDelete}
          title={t('タグを削除')}
          aria-label={name ? t('{0} を削除', name) : t('タグを削除')}
        >
          <i className="fa-solid fa-xmark" />
        </button>
      )}
    </span>
  )
}
