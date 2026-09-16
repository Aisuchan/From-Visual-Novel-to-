import { useEffect, useRef } from 'react'
import { getLanguage, t } from '../../../shared/i18n'
import './ExtraFunction.css'

/* Penpot: the six circles, left to right and top to bottom — the design draws
   them and names none of them. The marks are the app's own, Font Awesome
   glyphs laid beside one another where one is not enough: a gamepad and a
   picture each with a question at its lower right, the second picture with a
   heart at its lower left and another at its upper right besides, a
   microphone, and the currency of the language the app is kept in. The sixth
   is left as the design draws it. */
/** What a circle does when pressed. The shell answers them; the board only
    says which was pressed. */
export type ExtraAction =
  | 'random-game'
  | 'random-image'
  | 'random-r18-image'
  | 'voice-manager'
  | 'ledger'
  | 'csv-export'

interface Circle {
  color: string
  /** What the circle is called — its tooltip, what a reader is told, and the
      title of any board it puts up. */
  name: string
  action?: ExtraAction
  /** The glyph at the middle, if any. */
  base?: string
  /** A glyph at the circle's lower right, the base moving up and left to
      leave it room — a badge on the base rather than a mark over it. */
  over?: string
  /** Small glyphs at the circle's other two corners. */
  corners?: { glyph: string; at: 'bottom-left' | 'top-right' }[]
}

// i18n-keys
const CIRCLES: Circle[] = [
  { color: '#c62222', name: 'ランダムゲーム', base: 'fa-gamepad', over: 'fa-question', action: 'random-game' },
  { color: '#2651d1', name: 'ランダムピクチャー', base: 'fa-image', over: 'fa-question', action: 'random-image' },
  {
    color: '#2fad2b',
    name: 'ランダムエロピクチャー',
    base: 'fa-image',
    over: 'fa-question',
    action: 'random-r18-image',
    corners: [
      { glyph: 'fa-heart', at: 'bottom-left' },
      { glyph: 'fa-heart', at: 'top-right' }
    ]
  },
  { color: '#d1c11a', name: 'ボイスマネージャー', base: 'fa-microphone', action: 'voice-manager' },
  { color: '#7f1695', name: '帳簿', base: 'currency', action: 'ledger' },
  { color: '#8ab70a', name: 'CSV化', base: 'fa-file-csv', action: 'csv-export' }
]

/** The name a circle's action goes by, for the boards the shell puts up in
    its name. */
export function extraActionName(action: ExtraAction): string {
  return CIRCLES.find((circle) => circle.action === action)?.name ?? ''
}

/** How long the board takes to rise into place, and to sink out of it again;
    the stylesheet's two keyframes have to agree. */
export const EXTRA_SLIDE_MS = 110

interface Props {
  /** True while the board is on its way out: it sinks, and is unmounted once
      it has gone (`onGone`). */
  closing: boolean
  onGone: () => void
  /** A press outside the board, or Escape. The footer's own otter is excluded
      by the caller, that button being what toggles it. */
  onDismiss: () => void
  /** What a press outside it must not count: the button that opened it. */
  ignore: React.RefObject<HTMLElement>
  /** A circle pressed. The board is put away by the caller once it has
      answered, the answer being a change to the very display the board
      stands on. */
  onAction: (action: ExtraAction) => void
}

/**
 * Penpot board "Extra Function" (1c7a6731-6a56-809d-8008-a1b80fbac589),
 * 441x296 on #14171a under a 10px inner #657786 stroke, holding six 100px
 * circles in two rows of three. It stands in the Main Display's bottom-right
 * corner — the board is an absolute child of the column, `right: 0; bottom: 0`
 * — and rises into it from below when the footer's otter is pressed.
 */
export default function ExtraFunction({
  closing,
  onGone,
  onDismiss,
  ignore,
  onAction
}: Props): React.JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const away = (event: MouseEvent): void => {
      const target = event.target as Node
      if (boardRef.current?.contains(target)) return
      if (ignore.current?.contains(target)) return
      onDismiss()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [onDismiss, ignore])

  return (
    <div className="extra-function-slot">
      <div
        className={`extra-function${closing ? ' is-closing' : ''}`}
        ref={boardRef}
        onAnimationEnd={(event) => {
          if (closing && event.animationName === 'extra-function-sink') onGone()
        }}
      >
        {CIRCLES.map((circle, index) => {
          /* The purple circle's mark is money, in the money of the language
             the app is kept in — read as the mark is drawn, the way `t` is. */
          const base =
            circle.base === 'currency'
              ? getLanguage() === 'en'
                ? 'fa-dollar-sign'
                : 'fa-yen-sign'
              : circle.base
          return (
            <button
              key={circle.color}
              type="button"
              className={`extra-function-circle circle-${index}${circle.over ? ' has-over' : ''}`}
              /* The colour is carried as a custom property as well: a corner
                 glyph's rim is a text-stroke, which cannot inherit `color`. */
              style={{ background: circle.color, color: circle.color, '--circle': circle.color } as React.CSSProperties}
              title={t(circle.name)}
              aria-label={t(circle.name)}
              disabled={!circle.action}
              onClick={() => circle.action && onAction(circle.action)}
            >
              {base && <i className={`fa-solid ${base} extra-function-base`} />}
              {circle.over && <i className={`fa-solid ${circle.over} extra-function-over`} />}
              {circle.corners?.map((corner) => (
                <i
                  key={corner.at}
                  className={`fa-solid ${corner.glyph} extra-function-corner at-${corner.at}`}
                />
              ))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
