import { useLayoutEffect, useRef, useState } from 'react'
import type { Plan } from '../../../shared/db-types'
import PlanDetail, { PLAN_DETAIL_WIDTH } from './PlanDetail'
import './Notification.css'
import { t } from '../../../shared/i18n'

/** Penpot: Notification — 272 wide; the design's 206 is its two sample plates. */
export const NOTIFICATION_WIDTH = 272

/** The air between the board and the Plan Detail that hangs off it, which is
    the Plan panel's own (`HANG_GAP`). */
const HANG_GAP = 12

/** The shell's own width in design pixels: the side panel's 335 and the content
    column's 1585. */
const SHELL_WIDTH = 1920

interface Props {
  /** Today's plans that asked to be notified, in the order the day holds them. */
  plans: Plan[]
  /** Takes the mark off the footer's row: today's plans have been read. */
  onConfirm: () => void
}

/**
 * Penpot board "Notification" (9b0b99e8-c629-809a-8008-98b94e863f65), 272x206
 * — the plates the footer's own "Notification▲" row stands for, put up where
 * that row is. The design's 206 is what its two sample plates come to; the
 * board is as tall as the day makes it.
 *
 * A plate is the Plan panel's own, figure for figure — 15px radius, the name at
 * 28 over its description at 18 in #aab8c2, 10 in from the plate's left and 5
 * down, in the plan's own colour — at the 242 this board's padding leaves
 * rather than the panel's 269. Nothing here carries the notify mark the panel's
 * plates do: every plan on this board asked to be notified, so a mark saying so
 * would be on every one of them and tell no one anything.
 *
 * **A plate answers the pointer the way the panel's own does**: it comes up to
 * `brightness(1.2)` and puts Penpot's "Plan Detail" board up beside it — the
 * same component the Plan panel hangs off itself.
 */
export default function Notification({ plans, onConfirm }: Props): React.JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  /* The plan under the pointer and where its plate stands in the board. Held by
     id rather than as the plan itself, the way the panel holds it. */
  const [hover, setHover] = useState<{ id: number; top: number } | null>(null)
  /* Where the Plan Detail may stand: which side of the board it hangs off, and
     the band it has to stay inside, measured from the board's own top.
     **This board sits on the footer**, so unlike the panel's case there is
     almost nothing under it — the band is measured against the *window* at both
     ends, and the top of it is negative, the board being free to rise above the
     board it hangs off. Without that a long description went straight through
     the bottom of the window, there being nowhere below to put it. */
  const [room, setRoom] = useState<{ side: 'left' | 'right'; within: number; floor: number }>({
    side: 'right',
    within: 0,
    floor: 0
  })

  /* Measured rather than worked out: where the board lands across the footer is
     `space-between`'s to say, and how tall it is, is the day's. The shell is
     laid out in design pixels under a fractional zoom, so a measured rect is
     scaled back by the board's own known width. */
  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const scale = rect.width / NOTIFICATION_WIDTH
    const left = rect.left / scale
    setRoom({
      side:
        left + NOTIFICATION_WIDTH + HANG_GAP + PLAN_DETAIL_WIDTH <= SHELL_WIDTH ? 'right' : 'left',
      within: (window.innerHeight - rect.top) / scale,
      floor: -(rect.top / scale)
    })
  }, [plans])

  function trackHover(plan: Plan, plate: HTMLDivElement): void {
    /* `offsetTop` is measured from the board's own padding edge — the board is
       what is positioned, so it is the offset parent even though the plate sits
       in the list inside it — and it is unzoomed, which is the space the Plan
       Detail's `top` is read in too. The list scrolls once the day is long
       enough, so what has been scrolled comes off it. */
    setHover({ id: plan.id, top: plate.offsetTop - (listRef.current?.scrollTop ?? 0) })
  }

  const hovered = hover ? plans.find((plan) => plan.id === hover.id) : undefined
  const today = new Date()

  return (
    <div
      className="notification-board"
      ref={boardRef}
      role="dialog"
      aria-label={t('今日の予定')}
    >
      {/* Not in the design: which day these are, and the mark that says they
          have been read. The footer's own row stands for *today's* plans, so
          the day is written at the head of the board that puts them up, and
          confirming takes the mark off that row without taking the plans off
          the day. */}
      <div className="notification-head">
        <span className="notification-date">
          {today.getMonth() + 1}/{today.getDate()}
        </span>
        <button className="notification-confirm" onClick={onConfirm} title={t('確認した')}>
          <i className="fa-solid fa-check" />
        </button>
      </div>

      {/* The scroll is the list's rather than the board's: a board that clips
          would clip the Plan Detail hanging off its side with it. */}
      <div className="notification-list" ref={listRef}>
        {plans.map((plan) => (
          <div
            className="notification-plan"
            key={plan.id}
            style={{ background: plan.color }}
            /* The plate owns both ends of it, exactly as the Plan panel's own
               plates do. Held on the board instead, the detail stayed up while
               the pointer moved off a plate onto the head — the date and the
               check are not what it is about. Where the board stands is the
               plate's, not the pointer's, so there is nothing to track on a
               move. */
            onMouseEnter={(event) => trackHover(plan, event.currentTarget)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="notification-plan-name">{plan.name}</span>
            {plan.description && (
              <span className="notification-plan-note">{plan.description}</span>
            )}
          </div>
        ))}
      </div>

      {hovered && hover && (
        <PlanDetail
          plan={hovered}
          top={hover.top}
          side={room.side}
          within={room.within}
          floor={room.floor}
        />
      )}
    </div>
  )
}
