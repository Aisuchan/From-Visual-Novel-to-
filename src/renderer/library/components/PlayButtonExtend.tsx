import { useEffect, useRef, useState } from 'react'
import type { LaunchPrefs } from '../../../shared/db-types'
import './PlayButtonExtend.css'

interface Props {
  gameId: number
  onLaunch: (opts: { recordTime: boolean; useRecorderPanel: boolean; runAsAdmin: boolean }) => void
  disabled: boolean
}

export default function PlayButtonExtend({ gameId, onLaunch, disabled }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // Kept mounted through the closing animation, which is the grow run backwards.
  const [closing, setClosing] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [prefs, setPrefs] = useState<LaunchPrefs>({
    gameId,
    recordTime: true,
    useRecorderPanel: true,
    runAsAdmin: false,
    keepSetting: false
  })

  useEffect(() => {
    window.library.getLaunchPrefs(gameId).then(setPrefs)
  }, [gameId])

  const expanded = open && !closing

  /**
   * "Keep Setting" is what decides whether the three switches above it survive
   * this visit: ticked, they are written to the database (and the tick itself
   * is dropped, so Setting always reopens with it clear); unticked, the
   * database wins back and this visit's changes are forgotten.
   */
  function commitPrefs(): void {
    if (prefs.keepSetting) {
      const kept = { ...prefs, keepSetting: false }
      window.library.setLaunchPrefs(kept)
      setPrefs(kept)
    } else {
      window.library.getLaunchPrefs(gameId).then(setPrefs)
    }
  }

  function close(): void {
    if (!open || closing) return
    commitPrefs()
    setClosing(true)
  }

  function toggle(): void {
    if (!open) {
      setClosing(false)
      setOpen(true)
    } else if (closing) {
      // Clicking again mid-close takes it straight back to open.
      setClosing(false)
    } else {
      close()
    }
  }

  // Anything outside the split button dismisses Setting, by the same route the
  // caret takes — so "Keep Setting" is honoured either way. `prefs` is in the
  // dependencies because the handler has to see the ticks as they are now, not
  // as they were when Setting opened.
  useEffect(() => {
    if (!open || closing) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing, prefs])

  function launchNow(): void {
    onLaunch({
      recordTime: prefs.recordTime,
      useRecorderPanel: prefs.useRecorderPanel,
      runAsAdmin: prefs.runAsAdmin
    })
    close()
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
        onClick={toggle}
        aria-label="起動オプション"
        aria-expanded={expanded}
      >
        {/* Flips to point the other way while Setting is open, and back when
            it closes — including when launching closes it. */}
        <span className={`play-caret-glyph ${expanded ? 'flipped' : ''}`}>▲</span>
      </button>
    </>
  )

  return (
    <div className="play-split" ref={rootRef}>
      {playButton}

      {open && (
        <div
          className={`play-extend-popover ${closing ? 'closing' : ''}`}
          onAnimationEnd={() => {
            if (closing) {
              setOpen(false)
              setClosing(false)
            }
          }}
        >
          {/* Penpot: "Setting" — Girassol 36px, centred, 5px bottom padding */}
          <div className="play-extend-title">Setting</div>

          <label className="play-extend-row">
            <input
              type="checkbox"
              checked={prefs.recordTime}
              onChange={(e) => setPrefs({ ...prefs, recordTime: e.target.checked })}
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
            Keep Setting
          </label>

          {/* Overlays the play button above — this is the same control. */}
          <div className="play-split overlaid">{playButton}</div>
        </div>
      )}
    </div>
  )
}
