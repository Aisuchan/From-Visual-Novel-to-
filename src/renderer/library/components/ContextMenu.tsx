import './ContextMenu.css'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  /** Draws the row in the destructive colour on hover. */
  danger?: boolean
}

interface Props {
  /** Placed by the caller, in its own design-pixel space. */
  style: React.CSSProperties
  items: ContextMenuItem[]
}

/**
 * Penpot board "Right Click Menu" (859aefd8-f4ae-804d-8008-8e1ff363764a),
 * 201x295 at five options: a #2a2d31 plate with two rules down its left edge
 * and the options stacked beside them. The design draws no hover state, so the
 * row under the pointer takes the same wash the Play log's rows do.
 */
export default function ContextMenu({ style, items }: Props): React.JSX.Element {
  return (
    <div
      className="context-menu"
      style={style}
      /* The menus are dismissed on a window mousedown; a press inside one is
         the press that chooses an option, so it must not reach that. */
      onMouseDown={(event) => event.stopPropagation()}
    >
      {/* Penpot: border1 and border2 — 2x275 rules at x=10 and x=17 */}
      <span className="context-menu-rule" style={{ left: '10px' }} />
      <span className="context-menu-rule" style={{ left: '17px' }} />

      {items.map((item) => (
        <button
          key={item.label}
          className={`context-menu-option ${item.danger ? 'danger' : ''}`}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
