import { useEffect, useRef, useState } from 'react'
import { formatElapsed } from '../library/format'
import type { CaptureState } from '../../shared/ipc-types'
import './App.css'

/* The markup mirrors the Penpot board "Recorder Panel" one element per board,
   in the design's own order: Strech / Shrink Button, Play Time, Convinient
   Button, Move Button. The glyphs are Font Awesome rather than the design's
   plain rectangles. */

/* The panel's two resting widths, and the distance between them. The window
   is never narrower than `OVERLAY_MIN` (64) whatever is asked of it, so the
   shrunk panel sits in the corner of a slightly wider one — see windows.ts. */
const PANEL_WIDTH = 227
const PANEL_SHRUNK_WIDTH = 51
const TRAVEL = PANEL_WIDTH - PANEL_SHRUNK_WIDTH

const SHRINK_ANIM_MS = 220

/** How long a confirmation stays up. Long enough to read, short enough to miss. */
const TOAST_MS = 1000

/** easeInOutCubic. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export default function App(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [shrunk, setShrunk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [capture, setCapture] = useState<CaptureState>({ video: false, audio: false })
  const [toast, setToast] = useState<string | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    return window.overlay.onTick((payload) => {
      setElapsed(payload.elapsedSeconds)
      setPaused(payload.paused)
    })
  }, [])

  useEffect(() => {
    return window.overlay.onCaptureState(setCapture)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  async function handleScreenshot(): Promise<void> {
    try {
      const result = await window.overlay.takeScreenshot()
      if (result.savedTo) setToast('保存しました')
    } catch {
      setToast('保存に失敗しました')
    }
  }

  /* Starting one says nothing: the glyph turning red is the notice. Stopping
     one opens a save dialog, and only a file that went somewhere is announced. */
  async function handleToggleVideo(): Promise<void> {
    try {
      const { state, savedTo } = await window.overlay.toggleVideo()
      setCapture(state)
      if (savedTo) setToast('録画を保存しました')
    } catch {
      setToast('録画に失敗しました')
    }
  }

  async function handleToggleAudio(): Promise<void> {
    try {
      const { state, savedTo } = await window.overlay.toggleAudio()
      setCapture(state)
      if (savedTo) setToast('録音を保存しました')
    } catch {
      setToast('録音に失敗しました')
    }
  }

  async function handleTogglePause(): Promise<void> {
    const result = await window.overlay.togglePause()
    setPaused(result.paused)
  }

  /**
   * The strip — boards, fill, stroke and all — slides out under the Move
   * Button and back again. The window does not follow it frame by frame: it
   * is transparent, so the desktop shows through the instant the strip leaves
   * a spot, and the width only has to change once — at the end of a collapse
   * or the start of an expansion, where the strip already sits where the new
   * width wants it and the resize changes nothing on screen.
   *
   * Resizing every frame instead put the window's geometry and the page's
   * paint on two different clocks (one crosses the main process, the other
   * does not), and the Move Button — pinned to the edge that was supposed to
   * be standing still — jittered between them.
   */
  function handleToggleShrink(): void {
    const strip = stripRef.current
    if (busy || !strip) return
    const next = !shrunk
    const from = shrunk ? TRAVEL : 0
    const to = next ? TRAVEL : 0

    setBusy(true)
    // Set before the class change, so the rule for the resting state never
    // gets a frame of its own to snap to.
    strip.style.transform = `translateX(${from}px)`
    setShrunk(next)

    const slide = (): void => {
      const started = performance.now()
      const step = (now: number): void => {
        const progress = Math.min(1, (now - started) / SHRINK_ANIM_MS)
        strip.style.transform = `translateX(${from + (to - from) * ease(progress)}px)`

        if (progress < 1) {
          frameRef.current = requestAnimationFrame(step)
          return
        }
        frameRef.current = null
        // Hand the resting position back to the stylesheet.
        strip.style.transform = ''
        // Only now does the window give the desktop back: the strip is
        // already clear of the ground it is about to stop covering.
        if (next) window.overlay.setWidth(PANEL_SHRUNK_WIDTH)
        setBusy(false)
      }
      frameRef.current = requestAnimationFrame(step)
    }

    if (next) {
      slide()
      return
    }

    // Expanding needs the room before the strip slides back into it, and the
    // resize is a round trip through the main process — so wait for the width
    // to actually arrive rather than sliding into a viewport that would clip
    // the strip for the first frames.
    window.overlay.setWidth(PANEL_WIDTH)
    const deadline = performance.now() + 100
    const waitForRoom = (): void => {
      if (document.documentElement.clientWidth >= PANEL_WIDTH || performance.now() > deadline) {
        slide()
        return
      }
      frameRef.current = requestAnimationFrame(waitForRoom)
    }
    frameRef.current = requestAnimationFrame(waitForRoom)
  }

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  return (
    <div className={`overlay-panel${shrunk ? ' is-shrunk' : ''}${paused ? ' is-paused' : ''}`}>
      {/* One element carries the whole animation, the panel's own plate
          included, so the background cannot lag behind the boards. */}
      <div className="overlay-strip" ref={stripRef}>
        <div className="overlay-plate" />

        <div className="overlay-shrink">
          <button
            className="overlay-shrink-button"
            onClick={handleToggleShrink}
            title={shrunk ? 'パネルを広げる' : 'パネルを縮める'}
            aria-label={shrunk ? 'パネルを広げる' : 'パネルを縮める'}
          >
            {/* One glyph, turned over by CSS — swapping it for its mirror
                image would have nothing to animate between. */}
            <i className="fa-solid fa-chevron-right" />
          </button>
          <span className="overlay-shrink-border" />
        </div>

        {/* Kept mounted while shrunk: these are what slide out of view. */}
        <div className="overlay-play-time">
          <button className="overlay-play-pause" onClick={handleTogglePause} title="一時停止/再開">
            <i className={`fa-solid ${paused ? 'fa-play' : 'fa-stop'}`} />
          </button>
          <div className="overlay-time">
            <span>{formatElapsed(elapsed)}</span>
          </div>
        </div>

        <div className="overlay-convenient">
          <button className="overlay-shot" onClick={handleScreenshot} title="スクリーンショット">
            <i className="fa-solid fa-camera" />
          </button>
          <button
            className={`overlay-movie${capture.video ? ' is-recording' : ''}`}
            onClick={handleToggleVideo}
            title={capture.video ? '録画を停止' : 'ゲーム画面を録画'}
          >
            <i className="fa-solid fa-video" />
          </button>
          <button
            className={`overlay-sound${capture.audio ? ' is-recording' : ''}`}
            onClick={handleToggleAudio}
            title={capture.audio ? '録音を停止' : 'ゲーム音声を録音'}
          >
            <i className="fa-solid fa-microphone" />
          </button>
        </div>
      </div>

      {/* Outside the strip: the corner the strip slides under. */}
      <div className="overlay-move" title="ドラッグして移動">
        <span>⋮⋮</span>
      </div>

      {toast && <div className="overlay-toast">{toast}</div>}
    </div>
  )
}
