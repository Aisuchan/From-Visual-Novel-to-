import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GameWithStats } from '../../../shared/db-types'
import { fileUrl, formatLastPlayed, formatPlaytime, splitPlaytime } from '../format'
import PlayButtonExtend from './PlayButtonExtend'
import './GameDetail.css'

interface Props {
  game: GameWithStats
  isPlaying: boolean
  onLaunch: (opts: { recordTime: boolean; useRecorderPanel: boolean; runAsAdmin: boolean }) => void
  onPrev: () => void
  onNext: () => void
  onEditPlayTime: (gameId: number, seconds: number) => void
}

/* Penpot "Under decoration" geometry, in the 1585px content space: the rule
   runs along the top, drops through a fixed-slope diagonal into a recess, and
   climbs back at the right edge. Only the top run and the recess are elastic —
   the two diagonals and the total width are fixed. */
const UNDER_WIDTH = 1585
const UNDER_DIAGONAL = 161
const UNDER_RISE = 166
const UNDER_DEPTH = 126
const INFO_LEFT_MARGIN = 30
const ROUTE_MAX_WIDTH = 416
const ROUTE_SIDE_GAP = 30
const MIN_RECESS = ROUTE_MAX_WIDTH * 0.5 + ROUTE_SIDE_GAP

export default function GameDetail({
  game,
  isPlaying,
  onLaunch,
  onPrev,
  onNext,
  onEditPlayTime
}: Props): React.JSX.Element {
  const lastPlayed = formatLastPlayed(game.stats.lastPlayedAt)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const underRef = useRef<HTMLDivElement | null>(null)
  const infoRef = useRef<HTMLDivElement | null>(null)
  const [useShortTitle, setUseShortTitle] = useState(false)
  const [infoWidth, setInfoWidth] = useState(782)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ hours: '0', minutes: '0' })

  const canShorten = game.useShortName && !!game.shortName
  const displayTitle = canShorten && useShortTitle ? (game.shortName as string) : game.title

  // "if there is not enoght space to display the name, short name will be
  // displayed instead" — swap in the short name once the full title overflows
  // the space the Progress triangle leaves for it.
  useLayoutEffect(() => {
    setUseShortTitle(false)
  }, [game.id, game.title, game.shortName, game.useShortName])

  useEffect(() => {
    if (!canShorten || useShortTitle) return
    const el = titleRef.current
    if (!el) return
    const check = (): void => {
      if (el.scrollWidth > el.clientWidth + 1) setUseShortTitle(true)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [canShorten, useShortTitle, displayTitle])

  // Measure the play button + stats block so the rule and the ROUTE frame can
  // follow it. Both rects are read in the same (zoomed) space, and "Under" is
  // exactly UNDER_WIDTH design px, so the ratio recovers design pixels.
  useEffect(() => {
    const under = underRef.current
    const info = infoRef.current
    if (!under || !info) return
    const measure = (): void => {
      const underWidth = under.getBoundingClientRect().width
      if (underWidth <= 0) return
      const scale = underWidth / UNDER_WIDTH
      setInfoWidth(info.getBoundingClientRect().width / scale)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(under)
    observer.observe(info)
    return () => observer.disconnect()
  }, [])

  const recessEnd = UNDER_WIDTH - UNDER_RISE
  const maxTopEnd = recessEnd - UNDER_DIAGONAL - MIN_RECESS
  const topEnd = Math.min(Math.max(INFO_LEFT_MARGIN + infoWidth - 5, 400), maxTopEnd)
  const recessStart = topEnd + UNDER_DIAGONAL
  const recessWidth = recessEnd - recessStart
  const routeWidth = Math.min(ROUTE_MAX_WIDTH, recessWidth - ROUTE_SIDE_GAP)
  const routeLeft = recessStart + (recessWidth - routeWidth) / 2

  function beginEdit(): void {
    const { hours, minutes } = splitPlaytime(game.stats.totalPlaySeconds)
    setDraft({ hours: String(hours), minutes: String(minutes) })
    setEditing(true)
  }

  function commitEdit(): void {
    const hours = Number(draft.hours || 0)
    const minutes = Number(draft.minutes || 0)
    setEditing(false)
    onEditPlayTime(game.id, hours * 3600 + minutes * 60)
  }

  /** Digits only, and minutes never exceed 59. */
  function onDigits(field: 'hours' | 'minutes', raw: string): void {
    const digits = raw.replace(/\D/g, '').slice(0, field === 'hours' ? 4 : 2)
    setDraft((prev) => ({ ...prev, [field]: digits }))
  }

  return (
    <section className="game-detail">
      {/* Penpot: Top — 1585x197 */}
      <div className="game-top">
        <div className="game-titles">
          <div className="title-row">
            <h1 className="game-title" ref={titleRef} title={game.title}>
              {displayTitle}
            </h1>
            <span className="title-marker" title="ゲーム情報（未実装）">
              <i className="fa-solid fa-circle-info" />
            </span>
          </div>

          {/* Penpot: Under Line — solid bar plus a 132x8 tapering triangle */}
          <div className="title-underline">
            <span className="title-underline-bar" />
            <svg className="title-underline-tail" viewBox="0 0 132 8" preserveAspectRatio="none">
              <path d="M0,0 L132,0 L0,8 Z" fill="#e1e8ed" />
            </svg>
          </div>
        </div>

        {/* Penpot: Progress — 265x246 triangle, fill #1da1f2, stroke #e1e8ed 3px */}
        <svg className="game-progress" viewBox="0 0 265 246" preserveAspectRatio="none">
          <path
            d="M0,0 L265,246 L265,0 Z"
            fill="#1da1f2"
            stroke="#e1e8ed"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      {/* Penpot: Middle — 1585x610, space-between */}
      <div className="game-middle">
        <div className="sub-image" />

        <button className="nav-arrow" onClick={onPrev} aria-label="前のゲーム">
          <svg viewBox="0 0 43.29 86.58">
            <path d="M43.29,0 L43.29,86.58 L0,43.29 Z" fill="#B1B2B5" />
          </svg>
        </button>

        <div className="main-image">
          {game.thumbnailPath ? <img src={fileUrl(game.thumbnailPath)} alt={game.title} /> : null}
        </div>

        <button className="nav-arrow" onClick={onNext} aria-label="次のゲーム">
          <svg viewBox="0 0 43.29 86.58">
            <path d="M0,0 L0,86.58 L43.29,43.29 Z" fill="#B1B2B5" />
          </svg>
        </button>

        <div className="sub-image" />
      </div>

      {/* Penpot: Under — 1585x177, 50px top padding */}
      <div className="game-under" ref={underRef}>
        <svg
          className="under-decoration"
          viewBox={`0 0 ${UNDER_WIDTH} ${UNDER_DEPTH}`}
          preserveAspectRatio="none"
        >
          <path
            d={`M0,0 L${topEnd},0 L${recessStart},${UNDER_DEPTH} L${recessEnd},${UNDER_DEPTH} L${UNDER_WIDTH},0`}
            fill="none"
            stroke="#aab8c2"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className="button-and-info" ref={infoRef}>
          <PlayButtonExtend gameId={game.id} onLaunch={onLaunch} disabled={isPlaying} />

          <div className="stat">
            <span className="stat-label">
              total
              <br />
              play
            </span>
            <span className="stat-sep">:</span>
            {editing ? (
              <span className="stat-value stat-edit">
                <input
                  autoFocus
                  inputMode="numeric"
                  value={draft.hours}
                  onChange={(e) => onDigits('hours', e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
                  aria-label="プレイ時間（時）"
                />
                h
                <input
                  inputMode="numeric"
                  value={draft.minutes}
                  onChange={(e) => onDigits('minutes', e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
                  onBlur={commitEdit}
                  aria-label="プレイ時間（分）"
                />
                m
              </span>
            ) : (
              <span
                className="stat-value editable"
                onClick={beginEdit}
                title="クリックしてプレイ時間を編集"
              >
                {formatPlaytime(game.stats.totalPlaySeconds)}
              </span>
            )}
          </div>

          <div className="stat">
            <span className="stat-label">
              last
              <br />
              played
            </span>
            <span className="stat-sep">:</span>
            <span className="stat-value" title={lastPlayed.text}>
              {lastPlayed.lines[0]}
              {lastPlayed.lines[1] ? (
                <>
                  <br />
                  {lastPlayed.lines[1]}
                </>
              ) : null}
            </span>
          </div>
        </div>

        {/* Penpot: Route Manegement — centred in the recess the rule draws */}
        <div
          className="route-button"
          style={{ left: `${routeLeft}px`, width: `${routeWidth}px` }}
          title="Route 管理（未実装）"
        >
          <span>route</span>
        </div>

        {/* Penpot: Play Log Button — 77x76 (play log is deferred) */}
        <div className="play-log-button" title="Play Log（未実装）">
          <i className="fa-solid fa-file-lines" />
        </div>
      </div>

      {isPlaying && <div className="playing-badge">プレイ中…</div>}
    </section>
  )
}
