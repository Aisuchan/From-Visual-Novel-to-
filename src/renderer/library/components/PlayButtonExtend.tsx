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

  /* Penpot: Play Button — 291x62 (a 256px button plus a 35px "IF" caret).
     The same control appears at the foot of the Play Button Extend board, so
     the popover is anchored to sit its own copy exactly over this one. */
  const playButton = (
    <>
      <button className="play-main" disabled={disabled} onClick={launchNow}>
        play
      </button>
      <button
        className="play-caret"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label="起動オプション"
      >
        ▲
      </button>
    </>
  )

  return (
    <div className="play-split">
      {playButton}

      {open && (
        <div className="play-extend-popover">
          {/* Penpot: "Setting" — Girassol 36px, centred, 5px bottom padding */}
          <div className="play-extend-title">Setting</div>

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
            Play As Administrater
          </label>

          {/* Penpot's 291x1 divider is drawn as this row's top border. */}
          <label className="play-extend-row last">
            <input
              type="checkbox"
              checked={prefs.keepSetting}
              onChange={(e) => setPrefs({ ...prefs, keepSetting: e.target.checked })}
            />
            Keep This Setting
          </label>

          {/* Overlays the play button above — this is the same control. */}
          <div className="play-split overlaid">{playButton}</div>
        </div>
      )}
    </div>
  )
}
