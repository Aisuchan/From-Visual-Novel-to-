import { useEffect, useState } from 'react'
import type { GameWithStats, Session } from '../../../shared/db-types'
import './PlayLog.css'

interface Props {
  game: GameWithStats
  /** Drives the slide: the board is mounted off the right edge and comes in. */
  open: boolean
  /** Fired once the closing slide has finished, so GameDetail can unmount. */
  onClosed: () => void
}

/** The row tints Penpot gives the route/game clear entries. */
type LogTone = 'route-cleared' | 'game-cleared' | null

/** Penpot colours one run of some rows — the heroine, or GAME CLEARD. */
interface LogRun {
  text: string
  accent?: 'route' | 'clear'
}

interface LogEntry {
  key: string
  date: string
  runs: LogRun[]
  tone: LogTone
}

/**
 * sqlite writes `created_at` as UTC with no zone marker, while a session's
 * `startedAt` is a real ISO string. Only the former needs the marker added.
 */
function toDate(stamp: string): Date {
  return new Date(/[TZ]|[+-]\d{2}:\d{2}$/.test(stamp) ? stamp : `${stamp}Z`)
}

function formatDate(stamp: string): string {
  const date = toDate(stamp)
  if (Number.isNaN(date.getTime())) return '--'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Penpot writes durations "99 : 99", i.e. hours and minutes, both padded. */
function formatSpan(totalSeconds: number): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(Math.floor(totalSeconds / 3600))} : ${pad(
    Math.floor((totalSeconds % 3600) / 60)
  )}`
}

/**
 * Penpot board "Play log" (d7d10095-c9e9-809c-8008-7c124e12a2d0), 547x984 —
 * the same height as the Game board, so it covers the content column's right
 * edge while it is open.
 *
 * The design also draws `♡ CLEARED "HEROINE1"` rows. Those are route-level
 * events, which is deferred, so nothing produces them yet; what the library
 * records is the clear, every session, the first launch and the registration.
 */
export default function PlayLog({ game, open, onClosed }: Props): React.JSX.Element {
  const [sessions, setSessions] = useState<Session[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.library.listSessions(game.id).then((list) => {
      if (!cancelled) setSessions(list)
    })
    return () => {
      cancelled = true
    }
  }, [game.id])

  const entries: LogEntry[] = []
  // Newest first, the way the design stacks them: the clear, then the sessions,
  // then the first launch, then the registration at the bottom.
  if (game.clearedAt) {
    entries.push({
      key: 'cleared',
      date: formatDate(game.clearedAt),
      runs: [
        { text: '★ ' },
        { text: 'GAME CLEARD', accent: 'clear' },
        { text: `  in  ${formatSpan(game.clearPlaySeconds ?? 0)}` }
      ],
      tone: 'game-cleared'
    })
  }

  const played = (sessions ?? []).filter((session) => session.endedAt !== null)
  for (const session of played) {
    entries.push({
      key: `session-${session.id}`,
      date: formatDate(session.startedAt),
      runs: [
        {
          text: `PLAYED  for  ${formatSpan(session.durationSeconds)}${
            session.recorded ? '' : ' (not recorded)'
          }`
        }
      ],
      tone: null
    })
  }

  const firstSession = played[played.length - 1]
  if (firstSession) {
    entries.push({
      key: 'game-start',
      date: formatDate(firstSession.startedAt),
      runs: [{ text: 'GAME START!' }],
      tone: null
    })
  }

  entries.push({
    key: 'added',
    date: formatDate(game.createdAt),
    runs: [{ text: 'ADD GAME TO LIBRALY' }],
    tone: null
  })

  return (
    <aside
      className={`play-log ${open ? 'open' : ''}`}
      onTransitionEnd={(event) => {
        if (event.propertyName === 'transform' && !open) onClosed()
      }}
    >
      {/* Penpot: Log — "LOG" at 72px beside a 357x1 rule */}
      <div className="play-log-head">
        <span className="play-log-title">LOG</span>
        <span className="play-log-head-rule" />
      </div>

      {/* Penpot: Container — a 1x830 rule down the left, the rows beside it */}
      <span className="play-log-spine" />

      <div className="play-log-body">
        <div className="play-log-list">
          {entries.map((entry) => (
            /* The band carries the separator and the 15px clear either side of
               it, so hovering lights the strip from one rule to the next; the
               row inside keeps the design's own 29px height and its tint. */
            <div className="play-log-entry" key={entry.key}>
              <div className={`play-log-row ${entry.tone ?? ''}`}>
                <span className="play-log-date">{entry.date}</span>
                <span className="play-log-text">
                  {entry.runs.map((run, index) => (
                    <span key={index} className={run.accent ? `accent-${run.accent}` : undefined}>
                      {run.text}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Penpot: Path — the 164x124 wedge cutting the bottom-right corner */}
      <svg className="play-log-corner" viewBox="0 0 164 124" preserveAspectRatio="none">
        <path
          d="M164,0 L0,124 L164,124 Z"
          fill="#14171a"
          stroke="#aab8c2"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </aside>
  )
}
