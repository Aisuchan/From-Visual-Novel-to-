import { useEffect, useRef } from 'react'
import './OptionMenu.css'

/* Penpot: Menu (859aefd8-f4ae-804d-8008-8e1ff363764a) — a 201x295 board of
   five options behind two rules. It is the list both of the side panel's select
   rows drop out of. Two things are not the design's: the menu is as wide as the
   Select Group field and its button together (265 + 40) rather than 201, and
   its rows are set at the app's own 28px in a 34px box rather than the design's
   42 in 51 — a list of groups is as long as the library makes it, and at 42px
   five of them already run past the fold. Everything else keeps its literal
   value. */
const OPTION_FONT_SIZE = 28
/** 305 less the 34 the label starts at and the 30 of air on the right. */
const OPTION_WIDTH = 241
/** The design's own row and gap, which is what a row count comes to in px. */
const OPTION_HEIGHT = 34
const OPTION_GAP = 5
const OPTIONS_PADDING = 10

export interface MenuOption {
  key: string
  label: string
  /** Ink for this row's label. The design sets every one of them in #e1e8ed. */
  color?: string
}

interface Props {
  options: MenuOption[]
  onPick: (key: string) => void
  /** Design-px top of the menu inside the Search Option Container. */
  top: number
  /** How many rows stand before the list scrolls. */
  maxRows: number
  /** Puts the menu away without choosing anything. */
  onDismiss: () => void
  /** The row the menu hangs off. A click on the button in it is that button's
      own toggle and a click in the field is what puts the suggestions up, so
      the dismissal below has to leave the whole row alone. */
  anchorRef: React.RefObject<HTMLElement>
}

export default function OptionMenu({
  options,
  onPick,
  top,
  maxRows,
  onDismiss,
  anchorRef
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Anything outside the menu dismisses it, the way the Setting popover goes.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onDismiss()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onDismiss, anchorRef])

  const maxHeight =
    maxRows * OPTION_HEIGHT + (maxRows - 1) * OPTION_GAP + OPTIONS_PADDING * 2

  return (
    <div
      className="option-menu"
      ref={rootRef}
      role="menu"
      style={{ top }}
      /* A press in the menu must not move the caret out of the field: the
         suggestions are up only while the field holds it, and blurring here
         would put them away before the click that picked a row landed. */
      onMouseDown={(event) => event.preventDefault()}
    >
      {/* Penpot: border1 and border2 — two 2px rules down the left, 10px in,
          then 5px apart, with 15px of air before the options. */}
      <div className="option-menu-rule first" />
      <div className="option-menu-rule second" />

      {/* Penpot: Options — the grid of rows, 10px above and below, 5px apart. */}
      <div className="option-menu-options" style={{ maxHeight }}>
        {options.map((option) => (
          <MenuRow
            key={option.key}
            label={option.label}
            /* Penpot sets every option in #e1e8ed, which is what a row with no
               colour of its own is. A group carries one, so — as a route's name
               does on the Route board — it arrives inline. */
            color={option.color}
            onClick={() => onPick(option.key)}
          />
        ))}
      </div>
    </div>
  )
}

/* Penpot: Option1..5 — a box carrying the label at the left. A group's name is
   whatever was typed, and Japanese runs out of the column in a dozen
   characters, so the label steps down just far enough to fit the way the
   clock's date does. */
function MenuRow({
  label,
  color,
  onClick
}: {
  label: string
  color?: string
  onClick: () => void
}): React.JSX.Element {
  const textRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.fontSize = `${OPTION_FONT_SIZE}px`
    const width = el.scrollWidth
    if (width > OPTION_WIDTH) {
      el.style.fontSize = `${Math.floor(OPTION_FONT_SIZE * (OPTION_WIDTH / width))}px`
    }
  }, [label])

  return (
    <button type="button" className="option-menu-option" role="menuitem" onClick={onClick}>
      <span className="option-menu-label" ref={textRef} style={color ? { color } : undefined}>
        {label}
      </span>
    </button>
  )
}
