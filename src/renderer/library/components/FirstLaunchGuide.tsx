import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../../shared/i18n'
import { NOTE_URL } from './FooterBar'
import './FirstLaunchGuide.css'

/** How much wider than the note icon the bright circle is drawn, in viewport
    px — a small margin around the glyph, no frame. */
const RING_PAD = 6
/** The gap between the circle's top and the callout's arrow tip. */
const CALLOUT_GAP = 16
/** The air kept between the window and the window's own edge. */
const EDGE_MARGIN = 10

/** Where the note icon is, in viewport pixels. The overlay is `position: fixed`,
    so a measured client rect drops straight in — no design-pixel scaling. */
interface Spot {
  cx: number
  cy: number
  radius: number
}

/**
 * The first-launch coach-mark. Everything is dimmed a little except the note
 * icon, which is left bright inside a ring; a window over a downward arrow
 * points at it — 「このアプリの使い方はこちらから確認」 — and the two bob up and
 * down together. It is shown once, on a fresh library (`settings.guideSeen`),
 * and dismissed by clicking the note (which also opens it), clicking anywhere
 * else, or Escape.
 */
export default function FirstLaunchGuide({
  noteRef,
  onDismiss
}: {
  noteRef: React.RefObject<HTMLButtonElement>
  onDismiss: () => void
}): React.JSX.Element | null {
  const [spot, setSpot] = useState<Spot | null>(null)
  /* How far the window is nudged sideways off the arrow so it stays on screen.
     The note sits near the right edge, so a window centred on it would overflow;
     the arrow keeps pointing at the note and the window slides under it. */
  const [winShift, setWinShift] = useState(0)
  const winRef = useRef<HTMLDivElement | null>(null)

  /* The note's own place, measured after layout and again on a resize — the
     shell's zoom, and so the icon's size, move with the window. */
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = noteRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setSpot({
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        radius: Math.max(rect.width, rect.height) / 2 + RING_PAD
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [noteRef])

  /* Once the window is on screen — and again whenever the note moves — how far
     it has to slide to stay inside the viewport, the arrow staying on the note. */
  useLayoutEffect(() => {
    const win = winRef.current
    if (!spot || !win) return
    const half = win.getBoundingClientRect().width / 2
    const vw = window.innerWidth
    let shift = 0
    if (spot.cx + half > vw - EDGE_MARGIN) shift = vw - EDGE_MARGIN - (spot.cx + half)
    if (spot.cx - half + shift < EDGE_MARGIN) shift = EDGE_MARGIN - (spot.cx - half)
    setWinShift(shift)
  }, [spot])

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  if (!spot) return null

  const openNote = (): void => {
    void window.library.openExternal(NOTE_URL)
    onDismiss()
  }

  /* Portalled to the body rather than left in the shell: the shell is laid out
     under a fractional `zoom`, which would scale these viewport-measured
     coordinates down with it. At the body level a client rect maps one to one. */
  return createPortal(
    <div className="guide">
      {/* Catches a click anywhere in the dimmed area to dismiss. It is
          transparent; the dim itself is the spotlight's own box-shadow. */}
      <div className="guide-backdrop" onClick={onDismiss} />

      {/* The bright ring around the note. Its huge box-shadow is what dims the
          rest of the screen — the circle stays clear, so the note shows through
          at full brightness. A click on it opens the note page and dismisses. */}
      <div
        className="guide-spotlight"
        style={{
          left: `${spot.cx - spot.radius}px`,
          top: `${spot.cy - spot.radius}px`,
          width: `${spot.radius * 2}px`,
          height: `${spot.radius * 2}px`
        }}
        onClick={openNote}
        title={t('使い方・コンタクト')}
      />

      {/* The window over its arrow, both bobbing together. Anchored by its
          bottom (the arrow tip) just above the ring, centred on the note. */}
      <div
        className="guide-callout"
        style={{ left: `${spot.cx}px`, bottom: `${window.innerHeight - (spot.cy - spot.radius) + CALLOUT_GAP}px` }}
      >
        <div
          className="guide-window"
          ref={winRef}
          style={{ transform: `translateX(${winShift}px)` }}
        >
          {t('このアプリの使い方はこちらから確認')}
          <br />
          <span className="guide-window-note">{t('(ブラウザで開かれます)')}</span>
        </div>
        <div className="guide-arrow" />
      </div>
    </div>,
    document.body
  )
}
