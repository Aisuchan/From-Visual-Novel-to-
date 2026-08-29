import { useMemo, useState } from 'react'
import { playSound } from '../../playSound'
import './Balloons.css'

interface Props {
  /** Let go of the ceiling and clear the window, with the confetti. */
  leaving: boolean
}

/* Not in the design: the balloons that go up when a game is marked cleared. */
const COLORS = [
  '#e0245e',
  '#f5a623',
  '#ffe100',
  '#3fbf5f',
  '#1da1f2',
  '#8b5cf6',
  '#ff6f61',
  '#17bebb'
]
const COUNT = 18
/** Shards a burst balloon throws out. */
const SHARDS = 14

interface Balloon {
  id: number
  color: string
  /** Percentage across the display. */
  left: number
  scale: number
  /** Seconds before it sets off, and how long the climb takes. */
  delay: number
  climb: number
  /**
   * Where it comes to rest, as the top of its 120x184 box. The window's top
   * edge is the ceiling, so this is set from the balloon's own scale to put its
   * crown against it, plus a little so a row of them does not sit on one line.
   */
  rest: number
  /** How far it wanders sideways, in design px. */
  sway: number
}

/**
 * A batch of balloons rising over the whole Main Display. Only the balloons
 * take the pointer — the layer around them does not — and clicking one bursts
 * it. They are launched together with their own delays, so they arrive in a
 * ragged stream, and they gather against the window's top edge as if it were a
 * ceiling: the climb holds its last frame, so a balloon that is already up
 * there is still there to be clicked. When the confetti starts fading they let
 * go together and clear the top of the window with it.
 */
export default function Balloons({ leaving }: Props): React.JSX.Element {
  const balloons = useMemo<Balloon[]>(
    () =>
      Array.from({ length: COUNT }, (_, id) => {
        const scale = 0.65 + Math.random() * 0.6
        /* The crown sits 2px down in the 184px box, and the box scales about
           40% of its height, so this is where the crown ends up. */
        const crown = 73.6 + (2 - 73.6) * scale
        return {
          id,
          color: COLORS[id % COLORS.length],
          left: 3 + Math.random() * 92,
          scale,
          delay: Math.random() * 5,
          climb: 6.5 + Math.random() * 4,
          rest: -crown + Math.random() * 26,
          sway: (Math.random() * 2 - 1) * 90
        }
      }),
    []
  )
  const [popped, setPopped] = useState<number[]>([])

  function burst(id: number): void {
    setPopped((ids) => {
      if (ids.includes(id)) return ids
      playSound('./balloon.mp3', 0.3)
      return [...ids, id]
    })
  }

  return (
    <div className={`balloons ${leaving ? 'leaving' : ''}`} aria-hidden="true">
      {balloons.map((balloon) => (
        <button
          key={balloon.id}
          className={`balloon ${popped.includes(balloon.id) ? 'popped' : ''}`}
          style={{
            left: `${balloon.left}%`,
            animationDelay: `${balloon.delay}s`,
            animationDuration: `${balloon.climb}s`,
            color: balloon.color,
            top: `${balloon.rest}px`
          }}
          onClick={() => burst(balloon.id)}
        >
          <span
            className="balloon-sway"
            style={{
              animationDelay: `${balloon.delay}s`,
              // A slow sway either way, over roughly a third of the climb.
              animationDuration: `${balloon.climb / 3}s`,
              ['--sway' as string]: `${balloon.sway}px`
            }}
          >
            <span className="balloon-body" style={{ transform: `scale(${balloon.scale})` }}>
              <svg viewBox="0 0 60 92">
                <ellipse cx="30" cy="34" rx="26" ry="33" fill="currentColor" />
                <path d="M30 66 L24 76 H36 Z" fill="currentColor" />
                <path
                  d="M30 76 q9 8 0 15 q-9 7 0 1"
                  fill="none"
                  stroke="rgba(225,232,237,0.5)"
                  strokeWidth="2"
                />
                <ellipse
                  cx="20"
                  cy="21"
                  rx="6"
                  ry="10"
                  fill="rgba(255,255,255,0.4)"
                  transform="rotate(-22 20 21)"
                />
              </svg>

              {/* The burst: a ring thrown off the skin and the skin's own bits
                  flying out along their bearings. Drawn only while it pops. */}
              <span className="balloon-ring" />
              <span className="balloon-shards">
                {Array.from({ length: SHARDS }, (_, i) => (
                  <span
                    key={i}
                    className="balloon-shard"
                    style={{
                      ['--spoke' as string]: `${(360 / SHARDS) * i + (i % 3) * 7}deg`,
                      ['--throw' as string]: `${86 + (i % 4) * 26}px`,
                      ['--spin' as string]: `${i % 2 === 0 ? 220 : -260}deg`,
                      animationDelay: `${(i % 3) * 12}ms`
                    }}
                  />
                ))}
              </span>
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
