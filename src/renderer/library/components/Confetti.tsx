import { useEffect, useRef, useState } from 'react'
import { playSound } from '../../playSound'
import './Confetti.css'

/** Which celebration is running: the one under the score field, or the finale. */
export type ConfettiClip = 'input' | 'ok'

interface Props {
  clip: ConfettiClip
  /**
   * Fired once a one-shot clip reaches its last seconds and starts fading, so
   * whatever else is celebrating can bow out with it.
   */
  onFinishing?: () => void
  /** Fired when a one-shot clip runs out. */
  onEnded?: () => void
}

/* confetti1.mp4 is shot on a green screen — measured rgb(0,255,11) over 99% of
   the frame — so it is keyed by how far a pixel leans green over both of its
   other channels: transparent past FULL, faded in between, which is what keeps
   the confetti's edges from being cut out with a hard line. */
const GREEN_FULL = 110
/* Only the last stretch before the key is faded. Starting the ramp lower left
   an eighth of the pieces part-transparent, and over a dark board that is what
   read as the clip being dimmed by what was behind it. */
const GREEN_EDGE = 70

/**
 * When the crackers go off, in seconds into each clip. Measured off the frames
 * rather than guessed: confetti1 has exactly three bursts, each climbing from
 * an empty frame, and confetti2 is a continuous shower whose only burst is the
 * one it opens with. Reading these against the video's own clock is exact and
 * repeats with the loop — the coverage-jump heuristic they replace fired on the
 * clips' secondary swells and missed real ones depending on the frame rate.
 */
const CUES: Record<ConfettiClip, number[]> = {
  input: [0.1, 3.56, 7.16],
  ok: [0.05]
}

/** A backward jump in the video's clock this large is the loop coming round. */
const LOOP_BACK = 0.5

/** How long the finale takes to fade out at its end, in seconds. */
const FADE_SECONDS = 1.8

/**
 * Plays a confetti clip over the whole Main Display. Nothing in it takes the
 * pointer, so the board and the dialog underneath stay usable while it runs.
 *
 * Both clips are keyed onto a canvas rather than composited by the browser.
 * `mix-blend-mode: screen` would drop confetti2's black for free, but the layer
 * needs a `z-index` to sit over the board and that makes it a stacking context,
 * at which point the blend mixes with the layer's own empty backdrop and the
 * clip comes out a plain black rectangle (measured). Keying both is one code
 * path and depends on nothing but the pixels.
 *
 * The work runs on the video's own frame callback rather than the display's, so
 * it is done once per decoded frame rather than once per repaint — which is
 * also where the clip's clock is read to fire the crackers.
 *
 * A one-shot clip fades out over its last seconds rather than stopping dead.
 */
export default function Confetti({ clip, onFinishing, onEnded }: Props): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [ending, setEnding] = useState(false)
  const green = clip === 'input'

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let handle = 0
    let stopped = false
    // Where the clip's own clock has got to in its list of cues, and which of
    // the two cracker sounds is next.
    const cues = CUES[clip]
    let cue = 0
    let lastTime = 0
    let cracker = 0

    const draw = (): void => {
      if (stopped) return
      const width = video.videoWidth
      const height = video.videoHeight
      if (width && height) {
        if (canvas.width !== width) {
          canvas.width = width
          canvas.height = height
        }
        ctx.drawImage(video, 0, 0)
        const frame = ctx.getImageData(0, 0, width, height)
        const data = frame.data
        if (green) {
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const cap = r > b ? r : b
            const lean = g - cap
            if (lean > GREEN_FULL) {
              data[i + 3] = 0
              continue
            }
            if (lean > GREEN_EDGE) {
              data[i + 3] = Math.round(
                data[i + 3] * (1 - (lean - GREEN_EDGE) / (GREEN_FULL - GREEN_EDGE))
              )
            }
            /* Despill. Between a fifth and two fifths of the pieces come back
               leaning green (measured), which over this board reads as a muddy,
               darkened clip rather than confetti. The excess green is taken off
               and half of it handed to the other two channels, so the piece
               keeps the brightness the spill was carrying instead of losing it.
               A genuinely green piece is desaturated with it — unavoidable when
               the ground it was shot on is the same colour. */
            if (lean > 0) {
              data[i + 1] = cap
              const share = lean * 0.5
              data[i] = r + share > 255 ? 255 : r + share
              data[i + 2] = b + share > 255 ? 255 : b + share
            }
          }
        } else {
          /* confetti2.mp4 is shot on black. Carrying the brightest channel into
             the alpha drops the ground entirely and leaves each piece as bright
             as it was, which is what screening it onto the board would do. */
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            data[i + 3] = r > g ? (r > b ? r : b) : g > b ? g : b
          }
        }
        ctx.putImageData(frame, 0, 0)
      }

      const at = video.currentTime
      if (at < lastTime - LOOP_BACK) cue = 0
      lastTime = at
      while (cue < cues.length && cues[cue] <= at) {
        cue++
        playSound(cracker++ % 2 === 0 ? './cracker1.mp3' : './cracker2.mp3', 0.65)
      }

      schedule()
    }

    const schedule = (): void => {
      handle = video.requestVideoFrameCallback
        ? video.requestVideoFrameCallback(draw)
        : requestAnimationFrame(draw)
    }

    schedule()
    return () => {
      stopped = true
      if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
    }
  }, [green, clip])

  return (
    <div className={`confetti confetti-${clip} ${ending ? 'ending' : ''}`} aria-hidden="true">
      {/* The clip's own frames are never shown: the canvas beside it is what
          gets painted, so the source is kept at full size — and so decoding at
          full size — but drawn at zero opacity. */}
      <video
        ref={videoRef}
        className="confetti-source"
        src={green ? './confetti1.mp4' : './confetti2.mp4'}
        autoPlay
        muted
        playsInline
        loop={green}
        onTimeUpdate={() => {
          const video = videoRef.current
          if (green || ending || !video?.duration) return
          if (video.currentTime > video.duration - FADE_SECONDS) {
            setEnding(true)
            onFinishing?.()
          }
        }}
        onEnded={green ? undefined : onEnded}
      />
      <canvas ref={canvasRef} className="confetti-layer" />
    </div>
  )
}
