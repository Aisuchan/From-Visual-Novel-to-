import { useEffect, useState } from 'react'
import type { LaunchPrefs } from '../../../shared/db-types'
import './PlayButtonExtend.css'

interface Props {
  gameId: number
  onLaunch: (opts: { recordTime: boolean; useRecorderPanel: boolean; runAsAdmin: boolean }) => void
  disabled: boolean
}

export default function PlayButtonExtend({ gameId, onLaunch, disabled }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<LaunchPrefs>({
    gameId,
    useRecorderPanel: true,
    runAsAdmin: false,
    keepSetting: false
  })
  const [recordTime, setRecordTime] = useState(true)

  useEffect(() => {
    window.library.getLaunchPrefs(gameId).then(setPrefs)
  }, [gameId])

  function launchNow(): void {
    if (prefs.keepSetting) {
      window.library.setLaunchPrefs(prefs)
    }
    onLaunch({
      recordTime,
      useRecorderPanel: prefs.useRecorderPanel,
      runAsAdmin: prefs.runAsAdmin
    })
    setOpen(false)
  }

  return (
    <div className="play-split">
      <button className="play-main" disabled={disabled} onClick={launchNow}>
        PLAY
      </button>
      <button
        className="play-caret"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label="起動オプション"
      >
        ▲
      </button>

      {open && (
        <div className="play-extend-popover">
          <div className="play-extend-title">SETTING</div>

          <label className="play-extend-row">
            <input
              type="checkbox"
              checked={recordTime}
              onChange={(e) => setRecordTime(e.target.checked)}
            />
            Record Time
          </label>

          <label className="play-extend-row">
            <input
              type="checkbox"
              checked={prefs.useRecorderPanel}
              onChange={(e) => setPrefs({ ...prefs, useRecorderPanel: e.target.checked })}
            />
            Use Recorder Panel
          </label>

          <label className="play-extend-row">
            <input
              type="checkbox"
              checked={prefs.runAsAdmin}
              onChange={(e) => setPrefs({ ...prefs, runAsAdmin: e.target.checked })}
            />
            Play As Administrator
          </label>

          <hr />

          <label className="play-extend-row">
            <input
              type="checkbox"
              checked={prefs.keepSetting}
              onChange={(e) => setPrefs({ ...prefs, keepSetting: e.target.checked })}
            />
            Keep This Setting
          </label>

          <button className="play-extend-launch" onClick={launchNow}>
            PLAY
          </button>
        </div>
      )}
    </div>
  )
}
