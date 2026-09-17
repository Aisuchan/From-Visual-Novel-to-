import { useEffect, useRef, useState } from 'react'
import { formatElapsed } from '../library/format'
import { playSound, soundEffectUrl, SOUND_EFFECT_VOLUME } from '../playSound'
import type { CaptureState, RecordingKind } from '../../shared/ipc-types'
import { setLanguage, t } from '../../shared/i18n'
import './App.css'

/* The markup mirrors the Penpot board "Recorder Panel" one element per board,
   in the design's own order: Strech / Shrink Button, Play Time, Convinient
   Button, Move Button. The glyphs are Font Awesome rather than the design's
   plain rectangles. */

/* The panel's two resting widths, and the distance between them. The window
   is never narrower than `OVERLAY_MIN` (64) whatever is asked of it, so the
   shrunk panel sits in the corner of a slightly wider one — see windows.ts.
   Which corner that is, and therefore which way the strip folds, is the
   Setting board's to say. */
const PANEL_WIDTH = 227
const PANEL_SHRUNK_WIDTH = 51
const TRAVEL = PANEL_WIDTH - PANEL_SHRUNK_WIDTH

const SHRINK_ANIM_MS = 220

/** One frame at 60Hz — how far ahead the window is asked to make room. */
const FRAME_MS = 1000 / 60

/** How long a confirmation stays up. Long enough to read, short enough to miss. */
const TOAST_MS = 1000

/** How far the pointer travels before a press on the Move Button is a drag
    rather than the first click of a double-click. */
const DRAG_THRESHOLD = 3

/** easeInOutCubic. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/* Which corner the panel was opened in and whether it moves at all — the
   Setting board's own two rows, handed to this window on its command line
   because the panel has to be drawn the right way round on its first frame.
   Read once: neither changes while the panel is up. */
const CORNER = window.overlay.corner
const AT_LEFT = CORNER.endsWith('left')
const AT_TOP = CORNER.startsWith('top')

/* The 言語/language row, which arrives on the window's own command line with
   the corner and the scale — the panel is drawn once and never re-read, so
   this is set at the top of the module rather than during a render. */
setLanguage(window.overlay.language)

/* The Setting board's レコーダーパネルのサイズ row. The whole panel is scaled
   rather than re-tuned: every figure in the page stays the design's own, and
   the width the fold reports back is in those figures too — the main process
   scales the window and the region it is clipped to by the same number. */
const SCALE = window.overlay.scale

/* The Setting board's three 効果音 rows, already resolved to a file name by
   the main process — '' for a row left on なし. The two recordings have a row
   each: a screen recording stopping and an audio take stopping are different
   events, and what suits one need not suit the other. */
const SHOT_SOUND = window.overlay.shotSound
const RECORD_SOUND: Record<RecordingKind, string> = {
  video: window.overlay.videoSound,
  audio: window.overlay.audioSound
}

function playEffect(file: string): void {
  if (file) playSound(soundEffectUrl(file), SOUND_EFFECT_VOLUME)
}

export default function App(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [shrunk, setShrunk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [capture, setCapture] = useState<CaptureState>({ video: false, audio: false })
  const [toast, setToast] = useState<string | null>(null)
  /* Which way the panel faces. It opens as the Setting board's corner says
     (`AT_LEFT`) and a double-click of the Move Button turns it around; the way
     it folds follows it (`direction`). */
  const [atLeft, setAtLeft] = useState(AT_LEFT)
  const direction = atLeft ? -1 : 1
  const stripRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)

  /* The stylesheet's own kill switch, set on the document rather than passed
     down: what it turns off is the chevron's transition, which is a rule
     rather than anything this component runs. */
  document.documentElement.dataset.animations = window.overlay.animate ? 'on' : 'off'

  useEffect(() => {
    return window.overlay.onTick((payload) => {
      setElapsed(payload.elapsedSeconds)
      setPaused(payload.paused)
    })
  }, [])

  useEffect(() => {
    return window.overlay.onCaptureState(setCapture)
  }, [])

  /* The main process fires this as a recording's save dialog comes up. */
  useEffect(() => {
    return window.overlay.onPlayRecordEffect((kind) => playEffect(RECORD_SOUND[kind]))
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  async function handleScreenshot(): Promise<void> {
    /* On the press rather than on the answer: a shutter is the sound of the
       button, and the shot itself is a video frame with no audio in it, so
       there is nothing for it to land in. */
    playEffect(SHOT_SOUND)
    try {
      const result = await window.overlay.takeScreenshot()
      if (result.savedTo) setToast('保存しました')
    } catch {
      setToast('保存に失敗しました')
    }
  }

  /* Starting one says nothing: the glyph turning red is the notice. Stopping
     one opens a save dialog, and only a file that went somewhere is announced.

     **The effect sound is on the stop, never on the start.** A recording is
     the system's own loopback — everything the machine is playing, this app
     included — so a sound made as one starts is a sound in the file. It is
     played from the effect above rather than from here: the main process
     fires it as the save dialog comes up, which is after the recorder was
     stopped and the file closed, and before the player has answered the
     dialog. */
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

  /* A double-click of the Move Button turns the panel around. The layout flips
     here and the window flips there, both off the one gesture, so the two stay
     in step. Not mid-fold, when the window would be moved under the slide. */
  function handleFlip(): void {
    if (busy) return
    setAtLeft((v) => !v)
    window.overlay.flipSide()
  }

  /* The Move Button is dragged by moving the window from here rather than by the
     OS's own drag region: a transparent window's drag region swallows every
     event, so a double-click on it never arrives. Made a no-drag element, the
     button keeps its double-click, and the move is done by hand — pointer
     capture so it keeps coming once the pointer leaves the small button, a few
     pixels of travel before it counts as a drag so a double-click never nudges
     the window, and the pointer's *screen* position (which the window's own zoom
     does not touch) reported to the main process. */
  function handleMovePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.screenX, startY: e.screenY, moved: false }
    window.overlay.dragStart(e.screenX, e.screenY)
  }
  function handleMovePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (!drag) return
    if (!drag.moved && Math.hypot(e.screenX - drag.startX, e.screenY - drag.startY) < DRAG_THRESHOLD) {
      return
    }
    drag.moved = true
    window.overlay.dragMove(e.screenX, e.screenY)
  }
  function handleMovePointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  /**
   * The strip — boards, fill, stroke and all — slides out under the Move
   * Button and back again, and the window travels with it: the main process
   * is told the panel's width every frame, and it holds the window's right
   * edge and re-clips the window to exactly that width (see `setOverlayWidth`
   * and `applyOverlayShape` in windows.ts).
   *
   * It has to be every frame. The window is clipped to the panel, so the
   * ground the strip has left is not part of the window at all — change the
   * width once, at the end, and the fold reads as two movements: the content
   * shrinks, and then the window catches up.
   *
   * The two clocks that made this jitter before — the page's paint and the
   * window's geometry — no longer disagree about anything that is drawn: the
   * page is anchored to the corner's own outer edge, which is the edge held
   * here, so a resize landing a frame late moves nothing. Expanding still
   * asks for the room a frame early, because arriving late there would clip
   * the plate's inner edge, which is the one direction that shows.
   *
   * With the Setting board's アニメーション row off there is no slide at all:
   * the width is asked for and the class changed in the one go, the room
   * first so the wide panel is never painted into a narrow window.
   */
  function handleToggleShrink(): void {
    const strip = stripRef.current
    if (busy || !strip) return
    const next = !shrunk

    if (!window.overlay.animate) {
      window.overlay.setWidth(next ? PANEL_SHRUNK_WIDTH : PANEL_WIDTH)
      setShrunk(next)
      return
    }

    const from = shrunk ? TRAVEL : 0
    const to = next ? TRAVEL : 0
    const offsetAt = (progress: number): number => from + (to - from) * ease(progress)

    setBusy(true)
    // Set before the class change, so the rule for the resting state never
    // gets a frame of its own to snap to.
    strip.style.transform = `translateX(${from * direction}px)`
    setShrunk(next)

    const started = performance.now()
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / SHRINK_ANIM_MS)
      strip.style.transform = `translateX(${offsetAt(progress) * direction}px)`

      const ahead = next ? progress : Math.min(1, progress + FRAME_MS / SHRINK_ANIM_MS)
      window.overlay.setWidth(PANEL_WIDTH - offsetAt(ahead))

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step)
        return
      }
      frameRef.current = null
      // Hand the resting position back to the stylesheet.
      strip.style.transform = ''
      setBusy(false)
    }
    frameRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  return (
    <div
      className={`overlay-panel${atLeft ? ' at-left' : ''}${AT_TOP ? ' at-top' : ''}${
        shrunk ? ' is-shrunk' : ''
      }${paused ? ' is-paused' : ''}`}
      style={{ zoom: SCALE }}
    >
      {/* One element carries the whole animation, the panel's own plate
          included, so the background cannot lag behind the boards. */}
      <div className="overlay-strip" ref={stripRef}>
        <div className="overlay-plate" />

        <div className="overlay-shrink">
          <button
            className="overlay-shrink-button"
            onClick={handleToggleShrink}
            title={shrunk ? t('パネルを広げる') : t('パネルを縮める')}
            aria-label={shrunk ? t('パネルを広げる') : t('パネルを縮める')}
          >
            {/* One glyph, turned over by CSS — swapping it for its mirror
                image would have nothing to animate between. */}
            <i className="fa-solid fa-chevron-right" />
          </button>
          <span className="overlay-shrink-border" />
        </div>

        {/* Kept mounted while shrunk: these are what slide out of view. */}
        <div className="overlay-play-time">
          <button className="overlay-play-pause" onClick={handleTogglePause} title={t('一時停止/再開')}>
            <i className={`fa-solid ${paused ? 'fa-play' : 'fa-stop'}`} />
          </button>
          <div className="overlay-time">
            <span>{formatElapsed(elapsed)}</span>
          </div>
        </div>

        <div className="overlay-convenient">
          <button className="overlay-shot" onClick={handleScreenshot} title={t('スクリーンショット')}>
            <i className="fa-solid fa-camera" />
          </button>
          <button
            className={`overlay-movie${capture.video ? ' is-recording' : ''}`}
            onClick={handleToggleVideo}
            title={capture.video ? t('録画を停止') : t('ゲーム画面を録画')}
          >
            <i className="fa-solid fa-video" />
          </button>
          <button
            className={`overlay-sound${capture.audio ? ' is-recording' : ''}`}
            onClick={handleToggleAudio}
            title={capture.audio ? t('録音を停止') : t('ゲーム音声を録音')}
          >
            <i className="fa-solid fa-microphone" />
          </button>
        </div>
      </div>

      {/* Outside the strip: the corner the strip slides under. Dragged to move
          the panel (the window is moved from here — see `handleMovePointerDown`)
          and double-clicked to turn it around. */}
      <div
        className="overlay-move"
        title={t('ドラッグして移動 / ダブルクリックで左右反転')}
        onPointerDown={handleMovePointerDown}
        onPointerMove={handleMovePointerMove}
        onPointerUp={handleMovePointerUp}
        onDoubleClick={handleFlip}
      >
        <span>⋮⋮</span>
      </div>

      {toast && <div className="overlay-toast">{toast}</div>}
    </div>
  )
}
