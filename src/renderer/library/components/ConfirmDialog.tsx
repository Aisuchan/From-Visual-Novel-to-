import './ConfirmDialog.css'

interface Props {
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Penpot board "Delete Image Confilm" (3a42d79e-e96e-80d3-8008-8b9cae85e75a),
 * 450x278. The design sets the sentence in sourcesanspro; it is rendered in
 * this app's own faces instead, as everywhere else.
 */
export default function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm
}: Props): React.JSX.Element {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="delete-confirm" onClick={(e) => e.stopPropagation()}>
        {/* Penpot: Top — 450x56, fill #2a2d31, stroke #657786 5px inner */}
        <div className="delete-confirm-top">{title}</div>

        {/* Penpot: Confilm Sentence — 450x119, 40px vertical padding */}
        <div className="delete-confirm-sentence">{message}</div>

        {/* Penpot: OK and Cancel — 390x52, 30px gap, under a 390x1 rule */}
        <div className="delete-confirm-actions">
          <button className="delete-confirm-ok" onClick={onConfirm} autoFocus>
            OK
          </button>
          <button className="delete-confirm-cancel" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  )
}
