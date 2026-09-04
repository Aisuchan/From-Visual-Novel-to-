import { useEffect, useRef, useState } from 'react'
import type { NewPlanInput, Plan } from '../../../shared/db-types'
import { HEX } from '../color'
import ColorPicker from './ColorPicker'
import './PlanPanel.css'

/* Penpot: Plan — 319x637. The panel is widened to 353 so the 25 of margin its
   plates leave becomes 42 and the day steps have a margin of their own to sit
   in; everything inside keeps the design's own widths. */
export const PLAN_PANEL_WIDTH = 353
export const PLAN_PANEL_HEIGHT = 637

/* Penpot: Color Palette — a 3x2 grid read row by row. The design's own layer
   names (Red selected / Yellow / Blue, then Green / Sky Blue / Orange) do not
   match the fills it draws, so the fills are what is carried over. This is the
   Plan board's own palette rather than the Template Color one `color.ts`
   holds, which is the Route board's and the New Group Setting board's. */
const PLAN_SWATCHES = [
  '#b03e3e',
  '#c8bf35',
  '#4d49d8',
  '#c67b30',
  '#2d8c24',
  '#15aebd'
]

interface Props {
  /** Penpot writes the date as "12/31". */
  date: Date
  /** The day the panel is on, as the key a plan is stored against. */
  dateKey: string
  plans: Plan[]
  /** Where the panel sits in the board's own design pixels. */
  top: number
  left: number
  onClose: () => void
  /** Walks the panel to the day before or after this one, across the ends of
      the month if that is where the day falls. */
  onStepDay: (offset: number) => void
  onAdd: (input: NewPlanInput) => void
  onDelete: (planId: number) => void
  /** The cell the panel was opened on. A press there is that cell's own
      toggle, so the dismissal below has to leave it alone. */
  anchorRef: React.RefObject<HTMLElement>
}

export default function PlanPanel({
  date,
  dateKey,
  plans,
  top,
  left,
  onClose,
  onStepDay,
  onAdd,
  onDelete,
  anchorRef
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  /* Penpot draws the list and the Add Plan editor as two faces of the same
     board, the ADD PLAN button and the CANCEL / OK pair standing in the same
     slot. This is which of the two is up. */
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PLAN_SWATCHES[0])
  /* What is typed into the Color Code Input. It is its own state rather than
     the colour written back: a hex is only half a colour until all six digits
     are in, and rewriting the field from `color` would fight the typing. */
  const [code, setCode] = useState('')
  /* Penpot's own "ー" at the head is what turns the list into the face a plan
     can be taken off from: every plate pulls its right side in and a bin comes
     up in the room it leaves. The mark is not drawn at all on the editor face,
     there being no list under it to take anything off. */
  const [deleting, setDeleting] = useState(false)

  // The panel closes on the day it belongs to; a day switched to starts clean.
  useEffect(() => {
    setAdding(false)
    setName('')
    setDescription('')
    setColor(PLAN_SWATCHES[0])
    setCode('')
    setDeleting(false)
  }, [dateKey])

  // Anything outside the panel puts it away, the way a menu goes.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  const [notify, setNotify] = useState(false)

  function pickCode(typed: string): void {
    setCode(typed)
    const hex = typed.startsWith('#') ? typed : `#${typed}`
    if (HEX.test(hex)) setColor(hex.toLowerCase())
  }

  function submit(): void {
    const written = name.trim()
    if (!written) return
    onAdd({ date: dateKey, name: written, description: description.trim(), color, notify })
    setAdding(false)
    setName('')
    setDescription('')
    setColor(PLAN_SWATCHES[0])
    setCode('')
    setNotify(false)
  }

  return (
    <div className="plan-panel" ref={rootRef} style={{ top, left }}>
      {/* Penpot: Day — the date, and the mark that puts the panel away */}
      <div className="plan-panel-head">
        <span className="plan-panel-date">
          {date.getMonth() + 1}/{date.getDate()}
        </span>
        {!adding && (
          <button
            className={`plan-panel-close${deleting ? ' is-on' : ''}`}
            onClick={() => setDeleting((on) => !on)}
            aria-pressed={deleting}
            title={deleting ? '削除をやめる' : '予定を削除する'}
          >
            －
          </button>
        )}
      </div>

      {/* Not in the design: the panel is about one day, so it carries the step
          to the one either side of it — over the end of the month too, the
          grid coming with it. Off while a plan is being written — the day is
          what the form is for — and off while the list is the one a plan can
          be taken off. */}
      {!adding && !deleting && (
        <>
          <button className="plan-panel-step prev" onClick={() => onStepDay(-1)} title="前の日">
            <span className="plan-panel-step-glyph">▼</span>
          </button>
          <button className="plan-panel-step next" onClick={() => onStepDay(1)} title="次の日">
            <span className="plan-panel-step-glyph">▼</span>
          </button>
        </>
      )}

      <div className="plan-panel-rule" />

      {adding ? (
        /* Penpot: Add Plan — Name over Description over Color, then the
           Notification switch. Its fields are 242 wide and 38.5 in from either
           side of the panel. */
        <div className="plan-panel-form">
          <label className="plan-panel-field-name">Plan Name</label>
          <input
            className="plan-panel-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="NAME..."
            autoFocus
          />

          <label className="plan-panel-field-name plan-panel-gap">Description</label>
          <textarea
            className="plan-panel-textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="BEAUTIFUL PLAN..."
          />

          <label className="plan-panel-field-name plan-panel-gap">Color</label>
          {/* Penpot: Contents — the code field over the palette on the left,
              and the colour itself on the right */}
          <div className="plan-panel-color">
            <div className="plan-panel-color-left">
              {/* Penpot: Color Code Input — the colour itself is shown on the
                  inside end of the field that spells it, as it is on the New
                  Group Setting board. */}
              <div className="plan-panel-code">
                <input
                  value={code}
                  onChange={(event) => pickCode(event.target.value)}
                  placeholder="CODE..."
                  spellCheck={false}
                  aria-label="カラーコード"
                />
                <span className="plan-panel-code-dot" style={{ background: color }} />
              </div>
              <div className="plan-panel-palette">
                {PLAN_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={`plan-panel-swatch${swatch === color ? ' is-picked' : ''}`}
                    style={{ background: swatch }}
                    onClick={() => {
                      setColor(swatch)
                      setCode('')
                    }}
                    title={swatch}
                  />
                ))}
              </div>
            </div>
            {/* Penpot draws a 118x118 plate here. It is the picker, the same
                one the New Group Setting board carries. */}
            <ColorPicker
              className="plan-panel-picker"
              color={color}
              onChange={(next) => {
                setColor(next)
                setCode('')
              }}
            />
          </div>

          {/* Penpot: Notification — the word and its ☑. The flag is stored;
              nothing raises a notification yet. */}
          <label className="plan-panel-notify">
            <span>Notification</span>
            <input
              type="checkbox"
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
            />
          </label>
        </div>
      ) : (
        /* Penpot: Plan Container — one plate per plan, on the plan's own colour */
        <div className={`plan-panel-list${plans.length === 0 ? ' is-empty' : ''}`}>
          {plans.length === 0 && <span className="plan-panel-empty">no plan</span>}
          {plans.map((plan) => (
            <div className={`plan-panel-row${deleting ? ' deleting' : ''}`} key={plan.id}>
              <div className="plan-panel-plan" style={{ background: plan.color }}>
                <span className="plan-panel-plan-name">{plan.name}</span>
                {plan.description && (
                  <span className="plan-panel-plan-note">{plan.description}</span>
                )}
              </div>
              {/* The room the plate gives up while the head's mark is on. */}
              <button
                className="plan-panel-trash"
                onClick={() => onDelete(plan.id)}
                tabIndex={deleting ? 0 : -1}
                aria-hidden={!deleting}
                title="この予定を消す"
              >
                <i className="fa-solid fa-trash" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="plan-panel-rule" />

      {adding ? (
        /* Penpot: Change Button — the pair, 129.5x54 each and 10 apart, in the
           slot the ADD PLAN button stands in. The design puts CANCEL on the
           left; they are the other way round here. */
        <div className="plan-panel-change">
          <button className="plan-panel-ok" onClick={submit} disabled={!name.trim()}>
            OK
          </button>
          <button
            className="plan-panel-cancel"
            onClick={() => {
              setAdding(false)
              setName('')
              setDescription('')
              setColor(PLAN_SWATCHES[0])
              setCode('')
              setNotify(false)
            }}
          >
            CANCEL
          </button>
        </div>
      ) : (
        /* Penpot writes "ADD PALN" on this button; the word is set right here. */
        <button
          className="plan-panel-add"
          onClick={() => {
            setDeleting(false)
            setAdding(true)
          }}
        >
          ADD PLAN
        </button>
      )}
    </div>
  )
}
