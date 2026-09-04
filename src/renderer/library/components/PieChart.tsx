import { useEffect, useId, useState } from 'react'
import { formatShare, shareInk } from '../route-share'
import './PieChart.css'

/* Every figure below is written against the Route board's own 350x350 Circle
   and scaled to whatever box the chart is asked for, so the PlayTime Graph's
   750 is the same drawing at a little over twice the size.

   The ring fills the plate — it *is* the plate, drawn in the slices' colours
   instead of grey. The band is what the shares are written across, so it is a
   little wider than the reference's four tenths of the outer radius; the hole
   still holds what the middle carries comfortably. */
const BASE = 350
const BASE_RADIUS = 175
const BASE_HOLE = 95
/** The space left between neighbouring slices, and how far their corners are
    rounded. The reference keeps the seam a hairline and takes a good deal off
    the corners — about a twentieth of the ring's width against a sixth. */
const BASE_GAP = 2.5
const BASE_CORNER = 8
/** The radius of the circle the reveal is stroked on, wide enough that its
    stroke covers the whole plate once it has gone round. */
const BASE_WIPE_R = 150
/** Penpot sets a share at 26 against the Route board's 350. */
const BASE_SHARE_FONT = 26

/** A share thinner than this has no room for a label of its own. */
const LABEL_MIN = 0.03

/* How far a wedge comes off the stop, in degrees: every wedge gets the first
   figure, its share of the second, and the square of its share of the third.
   The squared term is what tells the big slices apart — it is next to nothing
   at a tenth of the ring and doubles the swing at the whole of it, so the more
   of the ring a slice holds the harder it comes back, without the small ones
   moving at all. Never more than half the wedge, so the shortest cannot
   rebound past their own start. */
/* How long the ring takes to set the whole of itself going. A wedge waits by
   where it begins, so the arrival runs round the ring from twelve o'clock
   rather than every slice setting off at once — which on a dozen of them read
   as the whole plate being switched on. The last wedge is a third of a second
   behind the first and still lands inside the movement, the sweep itself being
   0.8s. */
const SWEEP_STAGGER_S = 0.35

const REBOUND_BASE_DEG = 8
const REBOUND_SHARE_DEG = 24
const REBOUND_SHARE_SQ_DEG = 30

export interface PieSlice {
  key: string
  /** #rrggbb — the slice's own colour, which its share is inked against. */
  color: string
  /** Its fraction of the whole, which is what the wedge is cut to. */
  share: number
}

interface Props {
  slices: PieSlice[]
  /** The box the chart is drawn in, in design px. */
  size?: number
  /** Bumped to draw the arrival again — the boards keep their charts mounted
      and hidden rather than unmounting them. */
  reveal: number
  /** Held covered until the caller says the screen it is on has arrived. The
      PlayTime Graph waits out the board slot's own fade with it, so the two
      movements follow one another instead of running together; the Route
      board's own chart wants neither and takes the default. */
  ready?: boolean
  /** The slice being pointed at, wherever it was pointed at from — a wedge of
      the ring or a row of the list beside it, which come to the same thing. It
      is drawn as though the pointer were on it and **every other wedge is held
      back**, so one slice being asked about is one slice answering. */
  highlight?: string | null
  onSliceHover?: (key: string, event: React.MouseEvent) => void
  onSliceLeave?: () => void
}

/**
 * The ring the Route board draws its routes' play time as and the PlayTime
 * Graph board its games'. One wedge per slice, clockwise from twelve o'clock in
 * the order they are given, each carrying its own colour and its own share.
 */
export default function PieChart({
  slices,
  size = BASE,
  reveal,
  ready = true,
  highlight = null,
  onSliceHover,
  onSliceLeave
}: Props): React.JSX.Element | null {
  const scale = size / BASE
  const centre = size / 2
  const radius = BASE_RADIUS * scale
  const hole = BASE_HOLE * scale
  const corner = BASE_CORNER * scale
  const gap = BASE_GAP * scale
  const wipeR = BASE_WIPE_R * scale
  const labelR = (radius + hole) / 2
  /* One mask per chart on the page: an id shared between two would have the
     second's arcs uncovering the first. */
  const maskId = useId()

  function polar(rad: number, angle: number): string {
    return `${(centre + rad * Math.cos(angle)).toFixed(2)},${(
      centre +
      rad * Math.sin(angle)
    ).toFixed(2)}`
  }

  /** The whole ring, for the one slice that has it to itself — two circles
      wound against each other so the middle stays a hole. */
  function ringPath(outer: number, inner: number): string {
    return (
      `M ${centre - outer},${centre} A ${outer} ${outer} 0 1 0 ${centre + outer},${centre} ` +
      `A ${outer} ${outer} 0 1 0 ${centre - outer},${centre} Z ` +
      `M ${centre - inner},${centre} A ${inner} ${inner} 0 1 1 ${centre + inner},${centre} ` +
      `A ${inner} ${inner} 0 1 1 ${centre - inner},${centre} Z`
    )
  }

  /**
   * The sector between two boundary angles, held `inset` px clear of both. The
   * inset is a distance rather than an angle: each edge is the boundary line
   * moved sideways by it, so the space between two slices is the same width
   * all the way across the ring instead of opening out towards the rim. Where
   * that line meets a circle of radius `rad` is `asin(inset / rad)` round from
   * the boundary, which is why the outer and inner ends come back by different
   * amounts.
   */
  function sectorPath(
    fromAngle: number,
    toAngle: number,
    outer: number,
    inner: number,
    inset: number
  ): string {
    const turn = (rad: number): number => Math.asin(Math.min(inset / rad, 1))
    /* A wedge too narrow for both its insets collapses onto its own middle
       rather than past it, so what the round join paints is a nub centred where
       the slice actually is instead of one overrunning its neighbour. */
    const mid = (fromAngle + toAngle) / 2
    const o0 = Math.min(fromAngle + turn(outer), mid)
    const o1 = Math.max(toAngle - turn(outer), mid)
    const i0 = Math.min(fromAngle + turn(inner), mid)
    const i1 = Math.max(toAngle - turn(inner), mid)
    const large = o1 - o0 > Math.PI ? 1 : 0
    return (
      `M ${polar(outer, o0)} A ${outer} ${outer} 0 ${large} 1 ${polar(outer, o1)} ` +
      `L ${polar(inner, i1)} A ${inner} ${inner} 0 ${large} 0 ${polar(inner, i0)} Z`
    )
  }

  const outerR = radius - corner
  const innerR = hole + corner
  /* Half the gap, plus the corner stroke that grows the sector back out by
     that much again: the distance every edge is held off its boundary. */
  const edgeInset = gap / 2 + corner
  /* The narrowest wedge that still holds its gap at every radius. An edge is
     the boundary moved sideways by the inset, so it runs out of room at the
     inner rim first — `asin(inset / innerR)`, the wider of the two turns. A
     wedge thinner than twice that has no edges left to draw and collapses onto
     its own middle, where its sides are parallel to a ray of their own rather
     than to the boundaries either side, and the gap then opens out towards the
     rim. So anything under it is opened out to it, and the difference is taken
     back, in proportion, off the wedges with room to spare. Only the drawing is
     evened up — the share each label carries is still the slice's own. */
  const minSweep = Math.min(
    2 * Math.asin(Math.min(edgeInset / innerR, 1)),
    (Math.PI * 2) / Math.max(slices.length, 1)
  )
  const raw = slices.map((slice) => slice.share * Math.PI * 2)
  const owed = raw.reduce((sum, angle) => sum + Math.max(minSweep - angle, 0), 0)
  const spare = raw.reduce((sum, angle) => sum + Math.max(angle - minSweep, 0), 0)
  const sweeps = raw.map((angle) =>
    angle < minSweep ? minSweep : spare > 0 ? angle - (angle - minSweep) * (owed / spare) : angle
  )
  let swept = -Math.PI / 2
  const segments = slices.map((slice, index) => {
    const from = swept
    swept += sweeps[index]
    const mid = (from + swept) / 2
    return {
      slice,
      from,
      sweep: sweeps[index],
      d:
        slices.length === 1
          ? ringPath(outerR, innerR)
          : sectorPath(from, swept, outerR, innerR, edgeInset),
      labelX: centre + labelR * Math.cos(mid),
      labelY: centre + labelR * Math.sin(mid),
      labelInk: shareInk(slice.color)
    }
  })

  /* The sweep is only started once the chart it uncovers has been laid out and
     painted. Mounting a few dozen wedges, their rounded edges and their shares
     and starting an animation on the same frame left the first quarter-turn
     dropping frames; two `requestAnimationFrame`s put the start on a frame
     after that work is done and off the main thread's way.

     `chartKey` is what identifies one drawing of the chart. Comparing it
     against the armed one rather than holding a boolean is what keeps the
     sweep from ever running a frame it was not armed for: the moment there is
     a different chart to draw, the class is already off in the same render. */
  const chartKey = `${reveal}:${segments.length}`
  const [sweptKey, setSweptKey] = useState<string | null>(null)

  useEffect(() => {
    if (segments.length === 0 || !ready) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSweptKey(chartKey))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [chartKey, segments.length, ready])

  if (segments.length === 0) return null

  return (
    <svg
      className={`pie-chart ${sweptKey === chartKey ? 'sweeping' : ''} ${
        highlight ? 'has-highlight' : ''
      }`}
      viewBox={`0 0 ${size} ${size}`}
    >
      {/* Every wedge is drawn on clockwise from its own start, all of them at
          once. One arc per wedge does it: a circle stroked wide enough to cover
          the plate, turned to where that wedge begins, and dashed to exactly
          the length the wedge runs — so the dash sliding in from behind the
          start uncovers that wedge and no other. */}
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x={-size * 0.36}
        y={-size * 0.36}
        width={size * 1.72}
        height={size * 1.72}
      >
        {segments.map((segment) => {
          const reboundDeg =
            REBOUND_BASE_DEG +
            REBOUND_SHARE_DEG * segment.slice.share +
            REBOUND_SHARE_SQ_DEG * segment.slice.share * segment.slice.share
          /* Never past half the wedge, so the shortest cannot rebound back
             beyond their own start. */
          const rebound = Math.min((reboundDeg * Math.PI) / 180, segment.sweep / 2)
          /* The dash is measured in `pathLength` units rather than in the
             drawing's own, and the unit chosen is this wedge's rebound over a
             hundred. That is what lets the keyframes be plain numbers: the
             rebound is 100 to every wedge, whatever it comes to in degrees. */
          const unit = rebound / 100
          const circleUnits = (Math.PI * 2) / unit
          const arcUnits = segment.sweep / unit
          /* Where this wedge begins, as a fraction of the way round from twelve
             o'clock — which is what it waits by. */
          const startDelay =
            ((segment.from + Math.PI / 2) / (Math.PI * 2)) * SWEEP_STAGGER_S
          return (
            <circle
              key={`wipe-${segment.slice.key}`}
              className={`pie-chart-wipe ${sweptKey === chartKey ? 'sweeping' : ''}`}
              cx={centre}
              cy={centre}
              r={wipeR}
              fill="none"
              stroke="#ffffff"
              strokeWidth={wipeR * 2}
              pathLength={circleUnits.toFixed(3)}
              /* The gap is the whole circle, so the one dash is the only thing
                 on the path. The offset starts at the wedge's whole length,
                 which is where the keyframes pick it up. */
              strokeDasharray={`${arcUnits.toFixed(3)} ${circleUnits.toFixed(3)}`}
              strokeDashoffset={arcUnits.toFixed(3)}
              transform={`rotate(${((segment.from * 180) / Math.PI).toFixed(3)} ${centre} ${centre})`}
              /* Beats the shorthand's own 0, inline styles winning over the
                 sheet — the class is what carries the animation itself. */
              style={{ animationDelay: `${startDelay.toFixed(3)}s` }}
            />
          )
        })}
      </mask>
      <g mask={`url(#${maskId})`}>
        {segments.map((segment) => (
          <path
            key={segment.slice.key}
            className={highlight === segment.slice.key ? 'is-hovered' : undefined}
            d={segment.d}
            fillRule="evenodd"
            fill={segment.slice.color}
            stroke={segment.slice.color}
            strokeWidth={corner * 2}
            strokeLinejoin="round"
            onMouseMove={(event) => onSliceHover?.(segment.slice.key, event)}
            onMouseLeave={onSliceLeave}
          />
        ))}
        {/* The share each slice holds, written across its own arc. */}
        {segments
          .filter((segment) => segment.slice.share >= LABEL_MIN)
          .map((segment) => (
            <text
              key={`share-${segment.slice.key}`}
              className={`pie-chart-share${
                highlight && highlight !== segment.slice.key ? ' is-dimmed' : ''
              }`}
              x={segment.labelX}
              y={segment.labelY}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fill: segment.labelInk, fontSize: `${BASE_SHARE_FONT * scale}px` }}
            >
              {formatShare(segment.slice.share)}
            </text>
          ))}
      </g>
    </svg>
  )
}
