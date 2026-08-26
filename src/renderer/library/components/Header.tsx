import { useEffect, useState } from 'react'
import './Header.css'

export default function Header(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => window.library.onMaximizedChanged(setMaximized), [])

  return (
    <header className="app-header">
      <span className="app-header-title">From Visual Novel to ...</span>

      {/* Not in the Penpot design: the window needs controls, and the native
          ones can't fit the 36px header (Windows enforces a ~31px minimum and
          paints over the header's bottom rule). Styled to the header's own
          palette so they read as part of it. */}
      <div className="window-controls">
        <button
          className="window-control"
          onClick={() => window.library.minimizeWindow()}
          aria-label="最小化"
        >
          ─
        </button>
        <button
          className="window-control"
          onClick={() => window.library.toggleMaximizeWindow()}
          aria-label={maximized ? '元のサイズに戻す' : '最大化'}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button
          className="window-control close"
          onClick={() => window.library.closeWindow()}
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
