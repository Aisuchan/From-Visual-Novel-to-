import { useState } from 'react'
import Confetti from './Confetti'
import './ClearDialog.css'

interface Props {
  /** The score the game already carries, or '' when it has none. */
  initialScore: string
  onCancel: () => void
  /** null is a clear with no score, which the Progress triangle reads as 完. */
  onConfirm: (score: number | null) => void
}

/**
 * Penpot board "Clear Window" (859aefd8-f4ae-804d-8008-8e1c4aa6522f), 450x280.
 * The design sets 「点数を入力」 in sourcesanspro; it is rendered in this app's
 * own faces instead, as everywhere else. Its hidden "Enter Score" label is the
 * alternate the design keeps beside the field and is not drawn.
 */
export default function ClearDialog({
  initialScore,
  onCancel,
  onConfirm
}: Props): React.JSX.Element {
  const [score, setScore] = useState(initialScore)

  function confirm(): void {
    const raw = score.trim()
    onConfirm(raw === '' ? null : Math.min(100, Math.max(0, Number(raw))))
  }

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      {/* The clip belongs inside this backdrop rather than beside it: the
          backdrop is what darkens the board, and a sibling under it was being
          darkened with the board. In here it paints over the 60% black and
          under the window, which is where it was meant to be all along. */}
      <Confetti clip="input" />

      <div className="clear-window" onClick={(event) => event.stopPropagation()}>
        {/* Penpot: Top — 450x58, fill #2a2d31, stroke #657786 5px inner */}
        <div className="clear-window-top">!CLEAR!</div>

        {/* Penpot: Input Point — 450x119, 40px sides, 40/30 top/bottom */}
        <div className="clear-window-input-point">
          <label className="clear-window-label" htmlFor="clear-score">
            点数を入力
          </label>
          {/* Penpot: Input — 116x49, fill #2a2d31, radius 5, 10/20 padding. The
              field is the box itself rather than something inside it, so a
              press anywhere on the plate lands in the field. */}
          <input
            className="clear-window-input"
            id="clear-score"
            autoFocus
            inputMode="numeric"
            placeholder="0～100"
            value={score}
            onChange={(event) => setScore(event.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={(event) => event.key === 'Enter' && confirm()}
          />
        </div>

        {/* Penpot: Rectangle — 390x1 at x=30 */}
        <span className="clear-window-rule" />

        {/* Penpot: OK and Cancel — two 180x52 buttons, 30px apart */}
        <div className="clear-window-actions">
          <button className="clear-window-ok" onClick={confirm}>
            OK
          </button>
          <button className="clear-window-cancel" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  )
}
