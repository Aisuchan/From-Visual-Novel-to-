import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NewPlanInput, Plan } from '../../../shared/db-types'
import { HEX } from '../color'
import ColorPicker from './ColorPicker'
import PlanDetail, { PLAN_DETAIL_HEIGHT, PLAN_DETAIL_WIDTH } from './PlanDetail'
import './PlanPanel.css'
import { t } from '../../../shared/i18n'

/* Penpot: Plan — 319x637, the design's own. */
export const PLAN_PANEL_WIDTH = 319
export const PLAN_PANEL_HEIGHT = 637

/* The day steps stand outside the panel, so the board has to leave this much
   beyond the panel itself when it places one: the 12 of air they are held off
   at plus the 43.29 the Game board's own carousel arrow is wide. Kept in step
   with the `left`/`right` and the `width` the steps carry in PlanPanel.css. */
export const PLAN_STEP_SPACE = 55.29

/** The air between the panel and whatever hangs off it — the day steps, and
    the Plan Detail board on the other side of that gap. */
const HANG_GAP = 12

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
  /** The middle of the day's own cell, in the board's design pixels: the panel
      is centred on it, and holds itself inside the board from its own height,
      which is not the same on both faces. */
  middle: number
  /** The board's own height in design pixels, which is that clamp. */
  boardHeight: number
  left: number
  onClose: () => void
  /** Walks the panel to the day before or after this one, across the ends of
      the month if that is where the day falls. */
  onStepDay: (offset: number) => void
  onAdd: (input: NewPlanInput) => void
  /** What the editor writes when it was opened on a plan rather than blank —
      a plan double-clicked in the list. */
  onUpdate: (planId: number, input: NewPlanInput) => void
  onDelete: (planId: number) => void
  /** The board's own width in design pixels, which is what says whether the
      Plan Detail board has room on the panel's right. */
  boardWidth: number
  /** The cell the panel was opened on. A press there is that cell's own
      toggle, so the dismissal below has to leave it alone. */
  anchorRef: React.RefObject<HTMLElement>
}

export default function PlanPanel({
  date,
  dateKey,
  plans,
  middle,
  boardHeight,
  left,
  onClose,
  onStepDay,
  onAdd,
  onUpdate,
  onDelete,
  boardWidth,
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
  /* The plan the editor was opened on, or null while it is writing a new one:
     the two faces are the same form and this is the whole difference between
     them. */
  const [editingId, setEditingId] = useState<number | null>(null)
  /* The plan under the pointer and where its row stands in the panel, which is
     what the Plan Detail board is put up against. It is held by id rather than
     as the plan itself, so a plan written again while it is up is the one the
     board then draws. */
  const [hover, setHover] = useState<{ id: number; top: number } | null>(null)
  /* Where the panel actually stands. It is centred on the day's own cell and
     held inside the board, and it is the panel that does that rather than the
     board: the PlayTime face is only as tall as its list, and the same sum
     worked out for the design's 637 would put a short panel well off the cell
     it belongs to. Measured in a layout effect, so it is never painted at the
     wrong place first; the panel is laid out in design pixels under the shell's
     zoom, so the rect is scaled back by its own known width. */
  const [placedTop, setPlacedTop] = useState(middle - PLAN_PANEL_HEIGHT / 2)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const height = rect.height / (rect.width / PLAN_PANEL_WIDTH)
    setPlacedTop(Math.max(0, Math.min(middle - height / 2, boardHeight - height)))
  }, [middle, boardHeight, adding, deleting, plans.length])

  // The panel closes on the day it belongs to; a day switched to starts clean.
  useEffect(() => {
    setAdding(false)
    setEditingId(null)
    setName('')
    setDescription('')
    setColor(PLAN_SWATCHES[0])
    setCode('')
    setDeleting(false)
    setHover(null)
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
    /* A right press anywhere puts the panel away, the panel included: it is
       the one gesture on this board that means nothing else, and the app's own
       right-click menus are the side panel's and the Home board's rather than
       this one's. Its own menu is swallowed with it, so nothing else acts on
       the same press. */
    const onContext = (event: MouseEvent): void => {
      event.preventDefault()
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('contextmenu', onContext)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('contextmenu', onContext)
    }
  }, [onClose, anchorRef])

  const [notify, setNotify] = useState(false)

  function pickCode(typed: string): void {
    setCode(typed)
    const hex = typed.startsWith('#') ? typed : `#${typed}`
    if (HEX.test(hex)) setColor(hex.toLowerCase())
  }

  /** Puts the editor away and leaves the form as a blank one. */
  function closeForm(): void {
    setAdding(false)
    setEditingId(null)
    setName('')
    setDescription('')
    setColor(PLAN_SWATCHES[0])
    setCode('')
    setNotify(false)
  }

  function submit(): void {
    const written = name.trim()
    if (!written) return
    const input = { date: dateKey, name: written, description: description.trim(), color, notify }
    if (editingId !== null) onUpdate(editingId, input)
    else onAdd(input)
    closeForm()
  }

  /* A plan double-clicked in the list opens the same editor the ADD PLAN
     button does, with the plan's own name, description, colour and flag in it.
     The colour code field is left blank: it is what has been *typed*, and
     nothing has been. */
  function editPlan(plan: Plan): void {
    setHover(null)
    setDeleting(false)
    setEditingId(plan.id)
    setName(plan.name)
    setDescription(plan.description)
    setColor(plan.color)
    setCode('')
    setNotify(plan.notify)
    setAdding(true)
  }

  /* Where the Plan Detail board stands: against the row under the pointer,
     held inside the panel's own height so it is on the board wherever the row
     is. The panel is laid out in design pixels under the shell's zoom, so a
     measured rect is scaled back by the panel's own known width. */
  function hoverRow(plan: Plan, row: HTMLElement): void {
    const panel = rootRef.current
    if (!panel) return
    const panelRect = panel.getBoundingClientRect()
    const scale = panelRect.width / PLAN_PANEL_WIDTH
    const rowRect = row.getBoundingClientRect()
    const top = Math.max(
      0,
      Math.min(
        (rowRect.top - panelRect.top) / scale,
        PLAN_PANEL_HEIGHT - PLAN_DETAIL_HEIGHT
      )
    )
    setHover({ id: plan.id, top })
  }

  /* The board hangs off the panel's right unless what is left of the board
     there cannot hold it, in which case it goes to the left — the same rule
     the panel itself follows against a cell. */
  const detailSide =
    left + PLAN_PANEL_WIDTH + HANG_GAP + PLAN_DETAIL_WIDTH <= boardWidth ? 'right' : 'left'
  const hoveredPlan = hover ? plans.find((plan) => plan.id === hover.id) : undefined

  return (
    <div className="plan-panel" ref={rootRef} style={{ top: placedTop, left }}>
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
            title={deleting ? t('削除をやめる') : t('予定を削除する')}
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
      {/* The steps are not drawn while a plan's own board is up: it stands
          where one of them does, and the day is not what is being asked
          about. */}
      {!adding && !deleting && !hoveredPlan && (
        <>
          {/* The Game board's own carousel arrows: the same 43.29x86.58 path in
              #B1B2B5, coming up to #f5f8fa under the pointer. */}
          <button className="plan-panel-step prev" onClick={() => onStepDay(-1)}>
            <svg viewBox="0 0 43.29 86.58">
              <path d="M43.29,0 L43.29,86.58 L0,43.29 Z" fill="#B1B2B5" />
            </svg>
          </button>
          <button className="plan-panel-step next" onClick={() => onStepDay(1)}>
            <svg viewBox="0 0 43.29 86.58">
              <path d="M0,0 L0,86.58 L43.29,43.29 Z" fill="#B1B2B5" />
            </svg>
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
                  aria-label={t('カラーコード')}
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
              {/* The plate is the plan: it puts the Plan Detail board up beside
                  the panel while the pointer is on it, and opens the editor on
                  a double-click. Neither while the list is the one a plan can
                  be taken off — the bin is what a row means there. */}
              <div
                className="plan-panel-plan"
                style={{ background: plan.color }}
                onMouseEnter={(event) => {
                  if (!deleting) hoverRow(plan, event.currentTarget)
                }}
                onMouseLeave={() => setHover(null)}
                onDoubleClick={() => {
                  if (!deleting) editPlan(plan)
                }}
                title={t('ダブルクリックで編集')}
              >
                <span className="plan-panel-plan-name">
                  {/* Not in the design: a plan that has asked to be notified
                      carries the mark the footer's own Notification row does,
                      so which plans it is standing for is said on the plan
                      rather than only in the footer. */}
                  {plan.notify && <span className="plan-notify-dot" />}
                  {plan.name}
                </span>
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
              >
                <i className="fa-solid fa-trash" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Penpot: Plan Detail — the board that says what the plan under the
          pointer is, beside the panel rather than over it. */}
      {hoveredPlan && !adding && !deleting && (
        <PlanDetail
          plan={hoveredPlan}
          top={hover?.top ?? 0}
          side={detailSide}
          within={PLAN_PANEL_HEIGHT}
        />
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
          <button className="plan-panel-cancel" onClick={closeForm}>
            CANCEL
          </button>
        </div>
      ) : (
        /* Penpot writes "ADD PALN" on this button; the word is set right here. */
        <button
          className="plan-panel-add"
          onClick={() => {
            setDeleting(false)
            setEditingId(null)
            setAdding(true)
          }}
        >
          ADD PLAN
        </button>
      )}
    </div>
  )
}
