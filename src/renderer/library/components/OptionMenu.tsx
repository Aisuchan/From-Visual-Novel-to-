import { useCallback, useEffect, useRef, useState } from 'react'
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
/** Penpot's own board width, which the side panel's row comes to. */
const OPTION_MENU_WIDTH = 305
/** The side panel's fields start 14px in from the panel edge. */
const OPTION_MENU_LEFT = 14
/** A menu less the 34 the label starts at and the 30 of air on the right. */
const OPTION_LABEL_INSET = 64
/** The design's own row and gap, which is what a row count comes to in px. */
const OPTION_HEIGHT = 34
const OPTION_GAP = 5
const OPTIONS_PADDING = 10

export interface MenuOption {
  key: string
  label: string
  /** Ink for this row's label. The design sets every one of them in #e1e8ed. */
  color?: string
  /** Marks this as the row the list stands at — the Calender board's year and
      month for today. It takes the app's accent as its *plate* and keeps its
      own ink, so it is picked out without being set differently from the rows
      either side of it. */
  current?: boolean
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
  /* The board is as wide as the row it drops out of, and starts where that
     row's field starts. The side panel's is the default; the Add Game
     dialog's Group row is 426 wide and flush with its column. */
  left?: number
  width?: number
  /** What the rows are set at, where the design's own 28 is not the largest a
      menu has room for — the Calender board's, which is as wide as the run it
      drops out of allows and takes the type up to fill it. */
  fontSize?: number
  /** The row the list is to open on, brought into the middle of the box. A
      list long enough to scroll and ordered by something other than what is
      picked — the Calender board's years, which run 1980 to 2100 — would
      otherwise open at its own beginning rather than at where it stands. */
  scrollToKey?: string
}

export default function OptionMenu({
  options,
  onPick,
  top,
  maxRows,
  onDismiss,
  anchorRef,
  left = OPTION_MENU_LEFT,
  width = OPTION_MENU_WIDTH,
  fontSize = OPTION_FONT_SIZE,
  scrollToKey
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const optionsRef = useRef<HTMLDivElement | null>(null)

  /* Whether the list runs past the box, and which way. Penpot's 10px of air
     above and below the rules is what a *whole* list has; a list carrying on
     out of sight gives that air up on the side it carries on, and the rule
     runs into the menu's own edge and is cut off by it — the rule being cut
     off is the list being cut off. Without it a menu holding six of a dozen
     groups looked exactly like a menu holding all six. */
  const [more, setMore] = useState({ above: false, below: false })

  const readScroll = useCallback((): void => {
    const box = optionsRef.current
    if (!box) return
    // A pixel of slack: the shell's zoom is fractional and these are rounded.
    const above = box.scrollTop > 1
    const below = box.scrollTop + box.clientHeight < box.scrollHeight - 1
    setMore((was) => (was.above === above && was.below === below ? was : { above, below }))
  }, [])

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

  /* The design's row is 34 for the 28 its label is set at; a menu that takes
     its type up grows the row with it, since the row is only a floor
     (`min-height`) and the label's own line box is what fills it. The count of
     rows on show has to be measured against the row a menu actually has, or a
     list told to stand whole would scroll. */
  const rowHeight = Math.max(OPTION_HEIGHT, fontSize * 1.2)
  const maxHeight =
    maxRows * rowHeight + (maxRows - 1) * OPTION_GAP + OPTIONS_PADDING * 2

  /* Brought to the row the list opens on, before any of it is read. The
     browser's own scrolling is what does it, since `scrollTop` is in the
     element's unzoomed CSS px while a measured rect is not — the shell's zoom
     is between the two. Keyed on that row alone: the options array is a new
     one every render, and depending on it would drag the box back here every
     time the caller re-rendered. */
  useEffect(() => {
    const box = optionsRef.current
    if (!box || scrollToKey === undefined) return
    const index = options.findIndex((option) => option.key === scrollToKey)
    const row = index >= 0 ? box.children[index] : null
    if (row) row.scrollIntoView({ block: 'center' })
    readScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToKey])

  // The list is read as it stands, and again whenever it changes under the box.
  useEffect(readScroll, [readScroll, options, maxHeight])

  const ruleClass = [
    'option-menu-rule',
    more.above ? 'more-above' : '',
    more.below ? 'more-below' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className="option-menu"
      ref={rootRef}
      role="menu"
      style={{ top, left, width }}
      /* A press in the menu must not move the caret out of the field: the
         suggestions are up only while the field holds it, and blurring here
         would put them away before the click that picked a row landed. */
      onMouseDown={(event) => event.preventDefault()}
    >
      {/* Penpot: border1 and border2 — two 2px rules down the left, 10px in,
          then 5px apart, with 15px of air before the options. */}
      <div className={`${ruleClass} first`} />
      <div className={`${ruleClass} second`} />

      {/* Penpot: Options — the grid of rows, 10px above and below, 5px apart. */}
      <div
        className="option-menu-options"
        ref={optionsRef}
        style={{ maxHeight }}
        onScroll={readScroll}
      >
        {options.map((option) => (
          <MenuRow
            key={option.key}
            label={option.label}
            /* Penpot sets every option in #e1e8ed, which is what a row with no
               colour of its own is. A group carries one, so — as a route's name
               does on the Route board — it arrives inline. */
            color={option.color}
            current={option.current}
            fontSize={fontSize}
            maxWidth={width - OPTION_LABEL_INSET}
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
  current,
  fontSize,
  maxWidth,
  onClick
}: {
  label: string
  color?: string
  current?: boolean
  fontSize: number
  maxWidth: number
  onClick: () => void
}): React.JSX.Element {
  const textRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.fontSize = `${fontSize}px`
    const width = el.scrollWidth
    if (width > maxWidth) {
      el.style.fontSize = `${Math.floor(fontSize * (maxWidth / width))}px`
    }
  }, [label, fontSize, maxWidth])

  return (
    <button
      type="button"
      className={`option-menu-option${current ? ' is-current' : ''}`}
      role="menuitem"
      onClick={onClick}
    >
      <span className="option-menu-label" ref={textRef} style={color ? { color } : undefined}>
        {label}
      </span>
    </button>
  )
}
