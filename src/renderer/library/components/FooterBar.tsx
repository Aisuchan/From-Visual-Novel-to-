import { useEffect, useRef, useState } from 'react'
import type { FooterStats, Language, Plan } from '../../../shared/db-types'
import { formatHours, yearProgress } from '../format'
import Notification from './Notification'
import './FooterBar.css'
/* The square cut of the ErogameScape mark, rather than the roundel the Game
   Info board carries: this row is Font Awesome glyphs, which are ink to the
   edges of their box, and a roundel beside them read as the one that had been
   shrunk. */
import eroScaMark from '../../assets/erosca_square.png'
import vndbMark from '../../assets/VNDB.png'
import { maskOf } from '../mask'
import { getLanguage, t } from '../../../shared/i18n'

interface Props {
  stats: FooterStats | null
  onAddGame: () => void
  /** Puts Penpot's "Setting" board in the content column, or takes it away. */
  onToggleSetting: () => void
  settingOpen: boolean
  /** Today's plans that asked to be notified. The design draws the row inert;
      it stands for these, so it carries a mark while there are any and is
      pressed to put Penpot's own "Notification" board up over them. */
  duePlans: Plan[]
  /** Whether those have been confirmed on the board itself. The row still puts
      them up — they are still today's plans — but it stops standing for them:
      the mark goes and the run is the footer's dim ink again. */
  dueSeen: boolean
  onDueSeen: () => void
}

/* Where the footer's database mark leads, per language. The Japanese one is
   the 統計・解析 index rather than the site's root — it is the part of
   erogamescape the app reads, and the root is a portal page that has to be
   clicked through to reach it. */
const SITE_HOME: Record<Language, string> = {
  ja: 'https://erogamescape.dyndns.org/~ap2/ero/toukei_kaiseki/',
  en: 'https://vndb.org'
}

export default function FooterBar({
  stats,
  onAddGame,
  onToggleSetting,
  settingOpen,
  duePlans,
  dueSeen,
  onDueSeen
}: Props): React.JSX.Element {
  const [now, setNow] = useState(new Date())
  /* Whether the "Notification" board is up. It is the row's own — nothing else
     in the app opens or reads it — so it is held here rather than by the shell,
     which only says which plans it is about. */
  const [noticeOpen, setNoticeOpen] = useState(false)
  const noticeRef = useRef<HTMLDivElement | null>(null)
  const dueToday = duePlans.length
  /* What the row is *standing for*, which is not the same as what it can put
     up: plans that have been confirmed are still today's. */
  const standing = dueToday > 0 && !dueSeen

  /* Midnight, or a plan taken off the day, can leave the row standing for
     nothing while its board is up. */
  useEffect(() => {
    if (dueToday === 0) setNoticeOpen(false)
  }, [dueToday])

  /* A press outside it or Escape puts it away, and the row itself toggles it —
     the row is inside the slot, so a press on it is never "outside" and the
     click that follows is what turns it off. */
  useEffect(() => {
    if (!noticeOpen) return
    const away = (event: MouseEvent): void => {
      if (!noticeRef.current?.contains(event.target as Node)) setNoticeOpen(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setNoticeOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [noticeOpen])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  /* The design writes a date and a clock here; what stands in their place is
     Penpot's own "Year Progress Bar" — where the year has got to, which is the
     thing a library of play time is measured against. Redrawn on the second
     the clock used to tick on. */
  const progress = yearProgress(now)
  const percent = (progress * 100).toFixed(1)

  return (
    <footer className="footer-bar">
      {/* Penpot: Add Game — 335x56, fill #1da1f2, stroke #f5f8fa 2px inner */}
      <button className="footer-add-game" onClick={onAddGame}>
        Add Game +
      </button>

      {/* Penpot: Year Progress Bar — 264x36 on #14171a under a 5px inner
          #657786. The design writes the share inside the bar; it stands past
          its right edge here instead, in the same #657786 — the fill is that
          colour too, so a figure standing on it would be the one thing on the
          bar that could not be read. */}
      <div className="footer-date">
        <div
          className="footer-year"
          title={t('{0}年の{1}%が経過', now.getFullYear(), percent)}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number(percent)}
          aria-label={t('{0}年の経過', now.getFullYear())}
        >
          <span className="footer-year-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="footer-year-percent">{percent}%</span>
      </div>

      {/* Penpot: Play Time */}
      <div className="footer-play-time">
        Today {formatHours(stats?.todaySeconds ?? 0)}/Week {formatHours(stats?.weekSeconds ?? 0)}
        /Month {formatHours(stats?.monthSeconds ?? 0)}
      </div>

      {/* Penpot: Today List — "Notification▲". The design draws it inert;
          nothing raises a notification yet, but a plan can ask to be notified,
          and this is what stands for the ones whose day it is: a mark while
          there are any, and a press that puts Penpot's own "Notification" board
          up over the row. The slot is the row's own box taken to the footer's
          full height, which is what the board is placed against — see
          Notification.css. */}
      <div className={`footer-notification-slot${standing ? ' is-due' : ''}`} ref={noticeRef}>
        <button
          className={`footer-notification${standing ? ' is-due' : ''}`}
          onClick={() => setNoticeOpen((open) => !open)}
          disabled={dueToday === 0}
          title={dueToday > 0 ? t('今日の予定 {0}件', dueToday) : t('今日、通知のある予定はありません')}
          aria-expanded={noticeOpen}
        >
          {standing && <span className="footer-notification-dot" />}
          Notification<span className="footer-notification-caret">▲</span>
        </button>

        {noticeOpen && dueToday > 0 && (
          <Notification
            plans={duePlans}
            onConfirm={() => {
              onDueSeen()
              setNoticeOpen(false)
            }}
          />
        )}
      </div>

      {/* Penpot: Footer Icons — row-reverse, 7px gap: 🔞 📓 🐤 ⚙ left to right */}
      <div className="footer-icons">
        <button
          className={`footer-icon-gear ${settingOpen ? 'is-open' : ''}`}
          onClick={onToggleSetting}
          title={t('設定')}
          aria-label={t('設定')}
          aria-pressed={settingOpen}
        >
          <i className="fa-solid fa-gear" />
        </button>
        <span className="footer-icon" title={t('Twitter（未実装）')}>
          <i className="fa-brands fa-twitter" />
        </span>
        <span className="footer-icon" title={t('note（未実装）')}>
          <i className="fa-solid fa-book" />
        </span>
        {/* **The database, named by the language the app is kept in — and the
            button opens it.** Unlike the Game Info board's own mark, which says
            where *that game's* registered page is and so is read off its
            address, this one stands for no particular game: it is the site
            itself, in the system's own browser, and which of the two that is
            follows the reader. Japanese is erogamescape's own 統計・解析 index,
            which is the part of the site the Reference row reads; English is
            the VN Database's front page.

            `getLanguage()` is read as the mark is drawn, the way `t` is: the
            shell sets the language during its own render and re-renders the
            tree, so a row changed on the Setting board is answered here without
            a prop or a restart. */}
        <button
          className="footer-icon footer-site"
          onClick={() => void window.library.openExternal(SITE_HOME[getLanguage()])}
          title={SITE_HOME[getLanguage()]}
          aria-label={t('データベースを開く')}
        >
          <span
            className="footer-site-mark"
            style={maskOf(getLanguage() === 'ja' ? eroScaMark : vndbMark)}
          />
        </button>
      </div>
    </footer>
  )
}
