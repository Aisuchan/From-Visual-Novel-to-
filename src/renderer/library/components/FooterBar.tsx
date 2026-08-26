import { useEffect, useState } from 'react'
import type { FooterStats } from '../../../shared/db-types'
import { formatFooterClock, formatHours } from '../format'
import './FooterBar.css'

interface Props {
  stats: FooterStats | null
  onAddGame: () => void
}

export default function FooterBar({ stats, onAddGame }: Props): React.JSX.Element {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const { dateLabel, timeLabel } = formatFooterClock(now)

  return (
    <footer className="footer-bar">
      {/* Penpot: Add Game — 335x56, fill #1da1f2, stroke #f5f8fa 2px inner */}
      <button className="footer-add-game" onClick={onAddGame}>
        Add Game +
      </button>

      {/* Penpot: Date — 20px side padding, 15px gap */}
      <div className="footer-date">
        <span>{dateLabel}</span>
        <span>{timeLabel}</span>
      </div>

      {/* Penpot: Play Time */}
      <div className="footer-play-time">
        Today {formatHours(stats?.todaySeconds ?? 0)}/Week {formatHours(stats?.weekSeconds ?? 0)}
        /Month {formatHours(stats?.monthSeconds ?? 0)}
      </div>

      {/* Penpot: Today List — "Notification▲" (notifications are deferred) */}
      <div className="footer-notification" title="通知（未実装）">
        Notification<span className="footer-notification-caret">▲</span>
      </div>

      {/* Penpot: Footer Icons — row-reverse, 7px gap: 🔞 📓 🐤 ⚙ left to right */}
      <div className="footer-icons">
        <span className="footer-icon-gear" title="設定（未実装）">
          <i className="fa-solid fa-gear" />
        </span>
        <span className="footer-icon" title="Twitter（未実装）">
          <i className="fa-brands fa-twitter" />
        </span>
        <span className="footer-icon" title="note（未実装）">
          <i className="fa-solid fa-book" />
        </span>
        <span className="footer-icon" title="ErogeScape / VNDB（未実装）">
          🔞
        </span>
      </div>
    </footer>
  )
}
