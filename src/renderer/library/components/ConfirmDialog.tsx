import { useEffect, useLayoutEffect, useRef } from 'react'
import './ConfirmDialog.css'

interface Props {
  title: string
  message: string
  /* A note on the question rather than a second question — what the answer
     will do to something other than the thing named. It is set well under the
     sentence's own size because the board is the design's 450 and a line of
     Japanese at 32 comes to half again as much as that: what a note has to do
     is stand on one line under the question it belongs to. */
  note?: string
  /* A dialog with nothing to cancel is a notice rather than a question: OK is
     the only way out of it, and the backdrop is that same way out. The board
     is the same one — what is being said is still one sentence over a pair of
     buttons — and the single button keeps its own 180 and stands in the middle
     of the row rather than being stretched to fill it. */
  onCancel?: () => void
  onConfirm: () => void
  /* The design's OK / CANCEL, unless the question is not one of doing or not
     doing but of *which* — 反映する / 反映しない — where a CANCEL would read
     as the whole edit being thrown away. */
  confirmLabel?: string
  cancelLabel?: string
  /* What a press outside the board, or Escape, means. Left unset it is the
     CANCEL button over again — or OK, on a notice with nothing to cancel.
     Set, it is a third answer: neither of the two the buttons offer, but the
     question walked away from — the play-time question, whose CANCEL is
     itself a way of writing the edit, needs the walk-away to write nothing. */
  onDismiss?: () => void
  /** The 580-wide board, for a question of two lines. See the stylesheet. */
  wide?: boolean
}

/**
 * Penpot board "Delete Image Confilm" (3a42d79e-e96e-80d3-8008-8b9cae85e75a),
 * 450x278. The design sets the sentence in sourcesanspro; it is rendered in
 * this app's own faces instead, as everywhere else.
 */
/** Penpot sets the sentence at 32; how small it may be stepped down to before
    it is left to wrap instead. A run at 20 still reads as the question, where
    one squeezed to fit a whole file path would not. */
const SENTENCE_FONT_SIZE = 32
const SENTENCE_FLOOR = 20

export default function ConfirmDialog({
  title,
  message,
  note,
  onCancel,
  onConfirm,
  confirmLabel = 'OK',
  cancelLabel = 'CANCEL',
  onDismiss,
  wide = false
}: Props): React.JSX.Element {
  const notice = onCancel === undefined
  const messageRef = useRef<HTMLSpanElement | null>(null)
  const okRef = useRef<HTMLButtonElement | null>(null)
  const dismiss = onDismiss ?? onCancel ?? onConfirm

  /* Escape is the backdrop by key. Held in a ref so the listener is put on
     once and still calls whatever the latest render handed in. */
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      dismissRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /* **The OK button is focused a frame after the board is up, not as it
     mounts.** A question put up from an Enter — the play-time editor commits
     on `keydown` — is mounted inside that same key's dispatch, since React
     flushes a discrete event's state synchronously; with `autoFocus` the
     button had the focus by the time the key's `keypress` arrived, and a
     focused button takes Enter as a press. The question answered itself
     before it was ever painted, and answered it with OK. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => okRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  /* **A question stands on one line.** The board is the design's 450 and a
     line of Japanese at 32 is 27px a glyph, so 「この記録 (01 : 30)を削除します
     か？」 and 「「heroine 1」のクリア記録を削除しますか？」 wrapped, and a
     question broken in the middle of its verb reads as two things asked. The
     run is measured unwrapped and stepped down just far enough to fit, the way
     the clock's date is — and no further than `SENTENCE_FLOOR`: a run that
     would have to go smaller than that to stand on one line (a launch failure
     carrying a whole path) is left to wrap, which is what `pre-line` and
     `overflow-wrap` below are for. A newline the message carries on purpose
     is kept either way; only the wrapping the box would add is what is being
     fitted away. */
  useLayoutEffect(() => {
    const el = messageRef.current
    const box = el?.parentElement
    if (!el || !box) return
    el.style.fontSize = ''
    el.style.whiteSpace = 'pre'
    const style = getComputedStyle(box)
    const available =
      box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const width = el.scrollWidth
    el.style.whiteSpace = ''
    if (width > available && available > 0) {
      const size = Math.floor(SENTENCE_FONT_SIZE * (available / width))
      if (size >= SENTENCE_FLOOR) el.style.fontSize = `${size}px`
    }
  }, [message])

  return (
    <div className="dialog-backdrop" onClick={dismiss}>
      <div
        className={`delete-confirm${notice ? ' notice' : ''}${note ? ' has-note' : ''}${
          wide ? ' wide' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Penpot: Top — 450x56, fill #2a2d31, stroke #657786 5px inner */}
        <div className="delete-confirm-top">{title}</div>

        {/* Penpot: Confilm Sentence — 450x119, 40px vertical padding */}
        <div className="delete-confirm-sentence">
          <span className="delete-confirm-message" ref={messageRef}>
            {message}
          </span>
          {note !== undefined && <span className="delete-confirm-note">{note}</span>}
        </div>

        {/* Penpot: OK and Cancel — 390x52, 30px gap, under a 390x1 rule */}
        <div className={`delete-confirm-actions${notice ? ' notice' : ''}`}>
          <button className="delete-confirm-ok" onClick={onConfirm} ref={okRef}>
            {confirmLabel}
          </button>
          {onCancel && (
            <button className="delete-confirm-cancel" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
