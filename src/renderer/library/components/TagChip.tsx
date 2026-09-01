import { useEffect, useRef, useState } from 'react'
import './TagChip.css'

interface Props {
  name: string
  /** The chip Add Tag has just put out: the only one that can be written in. */
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
 * A chip is only written in as it is made; after that the name stands, and the
 * ✕ is what takes it back. A chip is as wide as what is written in it, which an
 * input cannot do by itself, so while it is being written the width comes from
 * a copy of the text laid out in the same face with the input over it.
 */
export default function TagChip({
  name,
  editing = false,
  onCommit,
  onDelete
}: Props): React.JSX.Element {
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // A rename that came from anywhere else wins back while this one is idle.
  useEffect(() => setValue(name), [name])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  return (
    <span className={`tag-chip ${onDelete ? '' : 'static'}`}>
      {editing ? (
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
            onBlur={() => onCommit?.(value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setValue(name)
                e.currentTarget.blur()
              }
            }}
            aria-label="タグ名"
          />
        </span>
      ) : (
        <span className="tag-chip-name">{name}</span>
      )}

      {onDelete && (
        <button
          className="tag-chip-remove"
          /* A press here must not blur the field first: that would settle the
             name and this click would then be deleting a chip that had already
             gone one way or another. */
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDelete}
          title="タグを削除"
          aria-label={name ? `${name} を削除` : 'タグを削除'}
        >
          <i className="fa-solid fa-xmark" />
        </button>
      )}
    </span>
  )
}
