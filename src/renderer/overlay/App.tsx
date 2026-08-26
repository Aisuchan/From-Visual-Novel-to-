import { useEffect, useState } from 'react'
import { formatElapsed } from '../library/format'
import './App.css'

export default function App(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
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
      setToast('スクリーンショットを保存しました')
    } catch {
      setToast('スクリーンショットに失敗しました')
    }
  }

  async function handleTogglePause(): Promise<void> {
    const result = await window.overlay.togglePause()
    setPaused(result.paused)
  }

  return (
    <div className="overlay-panel">
      {/* Penpot: Open / Close Button — 44x56 fill #090e17 + a 1x56 #B1B2B5 border */}
      <div className="overlay-open-close">
        <button onClick={() => window.overlay.closeOverlay()} title="パネルを閉じる">
          ▶
        </button>
        <span className="overlay-open-close-border" />
      </div>

      {/* Penpot: Play Time — 169x56, 15px side padding, 10px gap */}
      <div className="overlay-play-time">
        <button className="overlay-play-pause" onClick={handleTogglePause} title="一時停止/再開">
          {paused ? '▶' : '■'}
        </button>
        <span className="overlay-time">{formatElapsed(elapsed)}</span>
      </div>

      {/* Penpot: Convinient Button — 145x56, 10px side padding, 10px gap */}
      <div className="overlay-convenient">
        <button className="overlay-capture" onClick={handleScreenshot} title="スクリーンショット" />
        {/* Movie / sound capture are deferred — inert placeholders, as designed. */}
        <span className="overlay-capture movie" title="動画キャプチャ（未実装）" />
        <span className="overlay-capture" title="音声キャプチャ（未実装）" />
      </div>

      {/* Penpot: Move Button — 48x56, "⋮⋮" 44px #e1e8ed */}
      <div className="overlay-move" title="ドラッグして移動">
        ⋮⋮
      </div>

      {toast && <div className="overlay-toast">{toast}</div>}
    </div>
  )
}
