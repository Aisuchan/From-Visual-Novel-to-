import { useLayoutEffect, useRef, useState } from 'react'
import type { Plan } from '../../../shared/db-types'
import { HEX } from '../color'
import './PlanDetail.css'

/* Penpot: Plan Detail — 360x259. The panel places it against its own side, so
   these are what it measures the room for. The height is the design's own and
   the least the board can be: a description longer than the four lines the
   design draws takes the board *down* rather than being cut off at them, which
   is the one thing on it that is not a fixed figure. */
export const PLAN_DETAIL_WIDTH = 360
export const PLAN_DETAIL_HEIGHT = 259

/** Penpot fills the Color Flame with the plan's colour at 0.7. */
const FLAME_OPACITY = 0.7

/** The plan's own colour at the design's own opacity. A plate under a run has
    to keep the run legible, so the opacity is put on the colour rather than on
    the chip, which would take the name down with it. */
function flame(color: string): string {
  if (!HEX.test(color)) return color
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${FLAME_OPACITY})`
}

interface Props {
  plan: Plan
  /** Where the board stands against the panel's own top, in design pixels. */
  top: number
  /** Which side of the panel it hangs off — the right unless the board has no
      room for it there. */
  side: 'left' | 'right'
  /** The height it has to stay inside — the panel's own, the panel being what
      it is placed against and what is known to be on the board. A board grown
      past its 259 by a long description would otherwise hang off the bottom. */
  within: number
  /** How far above the parent's own top it may rise, as a negative offset.
      Nothing, for the Plan panel: there the band is the panel and a board is
      held inside it. The footer's Notification board is the case that needs it
      — it stands on the footer with next to nothing under it, so a description
      long enough has to be allowed to rise past the board it hangs off rather
      than through the bottom of the window. */
  floor?: number
}

/**
 * Penpot's "Plan Detail" board: the plan's name on a chip in its own colour
 * over a rule over its description. It stands beside the Plan panel while a
 * plan in the list is under the pointer, and takes no pointer events of its
 * own — it says what is being pointed at, and the pointer is on the row.
 */
export default function PlanDetail({
  plan,
  top,
  side,
  within,
  floor = 0
}: Props): React.JSX.Element {
  /* The board is as tall as its description makes it, so where it can stand is
     not known until it has been laid out: it is measured and then held inside
     the panel's own height. In a layout effect, so it is never painted at the
     place a taller board could not have. The panel is laid out in design pixels
     under the shell's zoom, so the measured rect is scaled back by the board's
     own known width. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [placedTop, setPlacedTop] = useState(top)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const height = rect.height / (rect.width / PLAN_DETAIL_WIDTH)
    setPlacedTop(Math.max(floor, Math.min(top, within - height)))
  }, [top, within, floor, plan.id, plan.name, plan.description])

  return (
    <div className={`plan-detail ${side}`} style={{ top: placedTop }} ref={rootRef} aria-hidden="true">
      {/* Penpot: Plan Name — the row, and the Color Flame chip inside it that
          is only as wide as the name. */}
      <div className="plan-detail-name">
        <span className="plan-detail-flame" style={{ background: flame(plan.color) }}>
          {plan.notify && <span className="plan-notify-dot" />}
          {plan.name}
        </span>
      </div>
      <div className="plan-detail-rule" />
      {/* Penpot: Description — 330 wide with the run 10 in from either side. */}
      <div className="plan-detail-desc">
        <span>{plan.description}</span>
      </div>
    </div>
  )
}
