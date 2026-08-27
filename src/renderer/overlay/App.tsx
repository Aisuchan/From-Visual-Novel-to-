import { useEffect, useState } from 'react'
import { formatElapsed } from '../library/format'
import './App.css'

/* The markup mirrors the Penpot board "Recorder Panel" one element per board,
   in the design's own order: Strech / Shrink Button, Play Time, Convinient
   Button, Move Button. */
export default function App(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [shrunk, setShrunk] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    return window.overlay.onTick((payload) => {
      setElapsed(payload.elapsedSeconds)
      setPaused(payload.paused)
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(timer)
  }, [toast])

  async function handleScreenshot(): Promise<void> {
    try {
      await window.overlay.takeScreenshot()
      setToast('保存しました')
    } catch {
      setToast('保存に失敗しました')
    }
  }

  async function handleTogglePause(): Promise<void> {
    const result = await window.overlay.togglePause()
    setPaused(result.paused)
  }

  async function handleToggleShrink(): Promise<void> {
    const next = !shrunk
    // The window resize has to land first, or the wider page would briefly
    // paint over the game while the sections are already gone.
    await window.overlay.setShrunk(next)
    setShrunk(next)
  }

  return (
    <div className={`overlay-panel${shrunk ? ' is-shrunk' : ''}`}>
      <div className="overlay-shrink">
        <button
          className="overlay-shrink-button"
          onClick={handleToggleShrink}
          title={shrunk ? 'パネルを広げる' : 'パネルを縮める'}
        >
          <span>{shrunk ? '◀' : '▶'}</span>
        </button>
        <span className="overlay-shrink-border" />
      </div>

      {!shrunk && (
        <>
          <div className="overlay-play-time">
            <button className="overlay-play-pause" onClick={handleTogglePause} title="一時停止/再開">
              <span>{paused ? '▶' : '■'}</span>
            </button>
            <div className="overlay-time">
              <span>{formatElapsed(elapsed)}</span>
            </div>
          </div>

          <div className="overlay-convenient">
            <button className="overlay-shot" onClick={handleScreenshot} title="スクリーンショット" />
            {/* Movie / sound capture are deferred — inert placeholders, as designed. */}
            <span className="overlay-movie" title="動画キャプチャ（未実装）" />
            <span className="overlay-sound" title="音声キャプチャ（未実装）" />
          </div>
        </>
      )}

      <div className="overlay-move" title="ドラッグして移動">
        <span>⋮⋮</span>
      </div>

      {toast && <div className="overlay-toast">{toast}</div>}
    </div>
  )
}
