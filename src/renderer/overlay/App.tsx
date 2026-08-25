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
      <button className="overlay-icon-button" onClick={handleTogglePause} title="一時停止/再開">
        {paused ? '▶' : '❚❚'}
      </button>

      <div className="overlay-timer">
        <span className={`rec-dot ${paused ? 'paused' : ''}`} />
        <span className="overlay-time">{formatElapsed(elapsed)}</span>
      </div>

      <button className="overlay-icon-button" onClick={handleScreenshot} title="スクリーンショット">
        📷
      </button>

      <button
        className="overlay-icon-button"
        onClick={() => window.overlay.closeOverlay()}
        title="パネルを閉じる"
      >
        ✕
      </button>

      <span className="overlay-drag-handle" title="ドラッグして移動">
        ⠿
      </span>

      {toast && <div className="overlay-toast">{toast}</div>}
    </div>
  )
}
