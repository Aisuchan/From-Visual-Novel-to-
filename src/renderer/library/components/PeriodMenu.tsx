import { useEffect, useRef, useState } from 'react'
import type { GraphPeriod } from '../../../shared/db-types'
import { PERIOD_ROWS } from '../period'
import OptionMenu from './OptionMenu'
import './PeriodMenu.css'
import { t } from '../../../shared/i18n'

/* Penpot: Setting Period (9b87421c-4b34-8035-8008-813a0596f964), 291x688 —
   the board the PlayTime Graph's Period Setting row drops out of. It is not
   `OptionMenu`: that board is a plain list of labels, and this one carries a
   SET DEFAULT on every row and a whole "SPECIFY THE PERIOD" block with six
   date fields under a rule, so it is its own component drawn to its own
   figures. Every number below is the design's, against the board's own 291. */

/** The years the Calender board's own menu offers, which is as far as anything
    can be reached to have been played in. */
const FIRST_YEAR = 1980
const LAST_YEAR = 2100

/* What a date field's own list comes to. The design draws no list for these
   fields, so they open the app's own `OptionMenu` — the same board the
   Calender board's year and month drop, with the same plate, rules, hover and
   accent on the row it stands at. It is narrower than Penpot's 201 because it
   hangs off an 86px field: a menu keeps 34 of rule and air on the left and 30
   on the right, so 150 leaves 86 for "2026" (48 at this size) and 120 leaves
   56 for a two-figure month or day. */
const YEAR_MENU_WIDTH = 150
const PART_MENU_WIDTH = 120
const PART_MENU_FONT_SIZE = 22
const PART_MENU_ROWS = 6

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** A day held inside its own month — picking February after the 31st would
    otherwise roll the date over into March. */
function makeDate(year: number, month: number, day: number): Date {
  return new Date(year, month, Math.min(day, daysInMonth(year, month)))
}

interface Props {
  /** The row the list stands at, or null while a specified range is on. */
  current: GraphPeriod | null
  /** The row SET DEFAULT was last pressed on. */
  defaultKey: GraphPeriod
  /** What the two date rows read, which is the period's own span. */
  from: Date
  to: Date
  top: number
  left: number
  anchorRef: React.RefObject<HTMLElement>
  onPick: (key: GraphPeriod) => void
  onSetDefault: (key: GraphPeriod) => void
  onSpecify: (from: Date, to: Date) => void
  onDismiss: () => void
}

export default function PeriodMenu({
  current,
  defaultKey,
  from,
  to,
  top,
  left,
  anchorRef,
  onPick,
  onSetDefault,
  onSpecify,
  onDismiss
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  /* The design draws the Date Setting out with its own hidden pair showing the
     ▼, and the ▲ beside it hidden — so ▼ is the mark the block carries while
     it is out, and ▲ is what the folded state shows. */
  const [specifying, setSpecifying] = useState(true)

  // Anything outside the menu puts it away, the way OptionMenu's own does.
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

  return (
    <div className="period-menu" ref={rootRef} role="menu" style={{ top, left }}>
      {/* Penpot: Period Options — 287x488, its twelve 39px rows 10 clear of
          the block's own top and bottom. */}
      <div className="period-menu-options">
        {PERIOD_ROWS.map((row) => (
          <div key={row.key} className={`period-menu-row${current === row.key ? ' is-current' : ''}`}>
            <button
              type="button"
              className="period-menu-label"
              role="menuitem"
              onClick={() => onPick(row.key)}
            >
              {row.label}
            </button>
            {/* Penpot draws a SET DEFAULT on every row and hides all twelve.
                It stands while its own row is under the pointer and no other,
                which is what a mark belonging to one row has to do. */}
            <button
              type="button"
              className={`period-menu-default${defaultKey === row.key ? ' is-default' : ''}`}
              onClick={() => onSetDefault(row.key)}
            >
              SET DEFAULT
            </button>
          </div>
        ))}
      </div>

      {/* Penpot: Border — 267x1 in #B1B2B5, 10 in from either side. */}
      <div className="period-menu-rule" />

      {/* Penpot: Spicifing — 287x195, a title row over the two date rows. */}
      <div className={`period-menu-specify${specifying ? '' : ' is-folded'}`}>
        <div className="period-menu-specify-head">
          <span className="period-menu-specify-title">SPECIFY THE PERIOD</span>
          <button
            type="button"
            className="period-menu-specify-caret"
            onClick={() => setSpecifying((was) => !was)}
          >
            {specifying ? '▼' : '▲'}
          </button>
        </div>
        {specifying && (
          <div className="period-menu-dates">
            <DateRow value={from} onChange={(next) => onSpecify(next, to)} />
            {/* Penpot: To — the same "»" the two dates above are joined by,
                turned a quarter round so it points at the row below. */}
            <span className="period-menu-to">»</span>
            <DateRow value={to} onChange={(next) => onSpecify(from, next)} />
          </div>
        )}
      </div>
    </div>
  )
}

/* Penpot: Start Date / End Date — 250x39, a year in 86 and a month and a day
   in 82 each, every one of them a value box with its own ▼ against it. */
function DateRow({
  value,
  onChange
}: {
  value: Date
  onChange: (next: Date) => void
}): React.JSX.Element {
  const year = value.getFullYear()
  const month = value.getMonth()
  const day = value.getDate()
  const years: number[] = []
  for (let at = FIRST_YEAR; at <= LAST_YEAR; at += 1) years.push(at)
  const months: number[] = []
  for (let at = 0; at < 12; at += 1) months.push(at)
  const days: number[] = []
  for (let at = 1; at <= daysInMonth(year, month); at += 1) days.push(at)

  return (
    <div className="period-menu-date">
      <NumField
        className="year"
        width={YEAR_MENU_WIDTH}
        options={years.map((one) => ({ value: one, label: String(one) }))}
        value={year}
        label={String(year)}
        onPick={(next) => onChange(makeDate(next, month, day))}
      />
      <NumField
        className="month"
        width={PART_MENU_WIDTH}
        options={months.map((one) => ({ value: one, label: pad(one + 1) }))}
        value={month}
        label={pad(month + 1)}
        onPick={(next) => onChange(makeDate(year, next, day))}
      />
      <NumField
        className="day"
        width={PART_MENU_WIDTH}
        options={days.map((one) => ({ value: one, label: pad(one) }))}
        value={day}
        label={pad(day)}
        onPick={(next) => onChange(makeDate(year, month, next))}
      />
    </div>
  )
}

/* Penpot: Now Setted Year / Month — a 33-tall box rounded on its outer corners
   under a 1px #aab8c2 stroke, with the ▼ that opens it carrying the other
   pair. The design draws no list for these, so what they open is the app's own
   `OptionMenu` — the board the Calender board's year and month drop, arriving
   on the same wipe, marking the row it stands at with the accent and brought
   to that row as it opens. It hangs off the value box rather than sitting
   inside the panel, so the Setting Period frame is not stretched by it; a
   field near the panel's right edge lets its list run past that edge, which is
   what a menu floating over a board does. */
function NumField({
  className,
  width,
  options,
  value,
  label,
  onPick
}: {
  className: string
  width: number
  options: { value: number; label: string }[]
  value: number
  label: string
  onPick: (next: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className={`period-menu-field ${className}`} ref={rootRef}>
      <button type="button" className="period-menu-value" onClick={() => setOpen((was) => !was)}>
        {label}
      </button>
      <button type="button" className="period-menu-caret" onClick={() => setOpen((was) => !was)}>
        ▼
      </button>
      {open && (
        <OptionMenu
          options={options.map((option) => ({
            key: String(option.value),
            label: option.label,
            current: option.value === value
          }))}
          onPick={(key) => {
            onPick(Number(key))
            setOpen(false)
          }}
          /* The value box's own left, and 3 under its 33 — the field is 39
             tall with the box centred in it. */
          top={36}
          left={5}
          width={width}
          fontSize={PART_MENU_FONT_SIZE}
          maxRows={PART_MENU_ROWS}
          scrollToKey={String(value)}
          onDismiss={() => setOpen(false)}
          anchorRef={rootRef}
        />
      )}
    </div>
  )
}
