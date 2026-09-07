import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './OptionMenu.css'
import { t } from '../../../shared/i18n'

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
  /** Puts a 試聴 button at this row's right end, which `onAudition` answers.
      For the Setting board's effect sounds, where a row is a number and
      hearing it is the only thing that says what it is. */
  audition?: boolean
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
  /** Fired by a row's 試聴 button, which is drawn only on the rows that ask
      for one. It does not pick the row: the button is the row's sibling
      rather than a button inside a button, so the press never reaches it. */
  onAudition?: (key: string) => void
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
  scrollToKey,
  onAudition
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

  /* Brought to the row the list opens on, before any of it is read.
     `scrollTop` and `offsetTop` are both in the element's own unzoomed CSS px,
     so the two agree and the shell's zoom never enters it — which is what a
     measured rect would have dragged in. It is written rather than left to
     `scrollIntoView`, whose job is to bring a row into the *window*: that
     scrolls every ancestor that can be scrolled, the board and the column with
     it, which is exactly what the placement below is undoing. A layout effect
     so it lands before that placement measures anything. Keyed on that row
     alone: the options array is a new one every render, and depending on it
     would drag the box back here every time the caller re-rendered. */
  useLayoutEffect(() => {
    const box = optionsRef.current
    if (!box || scrollToKey === undefined) return
    const index = options.findIndex((option) => option.key === scrollToKey)
    const row = index >= 0 ? (box.children[index] as HTMLElement | undefined) : undefined
    if (row) {
      const middle = row.offsetTop - box.offsetTop - (box.clientHeight - row.offsetHeight) / 2
      box.scrollTop = Math.max(0, middle)
    }
    readScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToKey])

  /*
   * Where the menu actually lands. `top` is where the caller hung it — flush
   * under the row it drops out of — and this is that, corrected when the list
   * would run off the bottom of what it is drawn inside.
   *
   * A menu is an absolutely positioned child of a board, so one hanging past
   * the bottom is overflow: it stretches what is around it rather than being
   * clipped by it. Two answers, in this order. **Scroll the row up**, by
   * exactly as much as the list is over by, so the list has the room where it
   * already is — the Setting board's rows are in a scroller of their own, and
   * this is what that scroller is for. **Or put the list above the row**, when
   * there is nothing left to scroll. Only if it fits in neither is it held
   * inside, which is the last resort and covers the row it belongs to.
   *
   * What it is measured against is the nearest ancestor that actually clips —
   * `.app-shell` where nothing closer does — rather than the board it is
   * positioned in. A menu hanging past its own board is ordinary and is what
   * a list floating over one does; hanging past the window is not.
   *
   * Everything is worked out in the parent's own design pixels: `offsetHeight`
   * and `scrollTop` are unzoomed, which is the space `top` is written in, and
   * a measured rect is not — so a rect is divided by the zoom the parent's own
   * two widths give.
   */
  const [placed, setPlaced] = useState<{ top: number | null; above: boolean }>({
    top: null,
    above: false
  })

  useLayoutEffect(() => {
    const root = rootRef.current
    const parent = root?.offsetParent as HTMLElement | null
    if (!root || !parent) return
    const anchor = anchorRef.current
    const height = root.offsetHeight

    /* Re-read on every step: scrolling the row moves it, and the answer to
       "does it fit now" has to be asked of where things actually are. */
    const frame = (): { limit: number; anchorTop: number; anchorBottom: number } => {
      const parentRect = parent.getBoundingClientRect()
      const scale = parentRect.width / parent.offsetWidth || 1
      const rect = anchor?.getBoundingClientRect()
      return {
        limit: (clipBottom(root) - parentRect.top) / scale,
        anchorTop: rect ? (rect.top - parentRect.top) / scale : top,
        anchorBottom: rect ? (rect.bottom - parentRect.top) / scale : top
      }
    }

    let at = frame()
    if (top + height <= at.limit) {
      setPlaced({ top: null, above: false })
      return
    }

    const scroller = scrollableAncestor(anchor)
    if (scroller) {
      scroller.scrollTop = Math.min(
        scroller.scrollHeight - scroller.clientHeight,
        scroller.scrollTop + (top + height - at.limit)
      )
      at = frame()
      if (at.anchorBottom >= 0 && at.anchorBottom + height <= at.limit) {
        setPlaced({ top: at.anchorBottom, above: false })
        return
      }
    }

    /* Whether the list ended up over the row is what its arrival is played
       from, so it is answered here rather than guessed at from the number: the
       last case holds the menu inside the frame and can land either side of
       the row it belongs to. */
    const over = at.anchorTop - height
    const settled = over >= 0 ? over : Math.max(0, at.limit - height)
    setPlaced({ top: settled, above: settled < at.anchorTop })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, left, width, maxHeight])

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
      /* A list that opens upward is uncovered upward: the wipe runs from the
         edge the row is on, which is its bottom when it stands over the row.
         Downward there, it read as arriving from the wrong end. */
      className={`option-menu${placed.above ? ' is-above' : ''}`}
      ref={rootRef}
      role="menu"
      style={{ top: placed.top ?? top, left, width }}
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
            onAudition={
              option.audition && onAudition ? () => onAudition(option.key) : undefined
            }
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
  onClick,
  onAudition
}: {
  label: string
  color?: string
  current?: boolean
  fontSize: number
  maxWidth: number
  onClick: () => void
  onAudition?: () => void
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

  /* The row and its 試聴 button are siblings in a box of their own rather than
     one inside the other: a button cannot hold a button, and a press on the
     mark must not also pick the row. The plate is still the row's and still
     runs the whole width of the menu — the mark is laid over its right end
     rather than taking a column out of it. */
  return (
    <div className={`option-menu-row${onAudition ? ' has-audition' : ''}`}>
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

      {onAudition && (
        <button
          type="button"
          className="option-menu-audition"
          onClick={onAudition}
          title={t('この音を聞く')}
          aria-label={t('試聴')}
        >
          <i className="fa-solid fa-play" />
        </button>
      )}
    </div>
  )
}

/** The bottom of the nearest thing above `el` that clips what runs past it —
    the window itself where nothing closer does. */
function clipBottom(el: HTMLElement): number {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
      return node.getBoundingClientRect().bottom
    }
  }
  return window.innerHeight
}

/** The nearest thing above `el` that is scrolled rather than simply tall. */
function scrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node
    }
  }
  return null
}
