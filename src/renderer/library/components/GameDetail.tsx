import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GameWithStats } from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import { formatLastPlayed, formatPlaytime, splitPlaytime } from '../format'
import PlayButtonExtend from './PlayButtonExtend'
import './GameDetail.css'

interface Props {
  game: GameWithStats
  isPlaying: boolean
  onLaunch: (opts: { recordTime: boolean; useRecorderPanel: boolean; runAsAdmin: boolean }) => void
  onEditPlayTime: (gameId: number, seconds: number) => void
  /** Opens the Add Thumbnail screen for this game. */
  onOpenThumbnails: () => void
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

/* Carousel geometry, all from Penpot's "Middle": the Main Image is 1084x610 at
   x=250.5, and each Sub Image is a 142px window at the row's outer edge. A
   neighbour drawn at 467/610 of full size and slid 1065.5px lands its edge
   exactly on that window — and its height on the design's 467 — so the row's
   own overflow does the cutting and no separate Sub Image frame is needed. */
const SIDE_SCALE = 467 / 610
const SIDE_SHIFT = 1065.5
/* One item width further out again, i.e. clear of the row. */
const OFF_SHIFT = SIDE_SHIFT + 830
const SLOT_OFFSETS = [-2, -1, 0, 1, 2]

function slotTransform(offset: number): string {
  if (offset === 0) return 'translateX(0) scale(1)'
  const shift = (Math.abs(offset) === 1 ? SIDE_SHIFT : OFF_SHIFT) * Math.sign(offset)
  return `translateX(${shift}px) scale(${SIDE_SCALE})`
}

export default function GameDetail({
  game,
  isPlaying,
  onLaunch,
  onEditPlayTime,
  onOpenThumbnails
}: Props): React.JSX.Element {
  const lastPlayed = formatLastPlayed(game.stats.lastPlayedAt)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const underRef = useRef<HTMLDivElement | null>(null)
  const infoRef = useRef<HTMLDivElement | null>(null)
  const [useShortTitle, setUseShortTitle] = useState(false)
  const [infoWidth, setInfoWidth] = useState(782)
  const [carousel, setCarousel] = useState<string[]>([])
  const [imageIndex, setImageIndex] = useState(0)
  const [animated, setAnimated] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ hours: '0', minutes: '0' })
  const committedRef = useRef(false)

  const canShorten = game.useShortName && !!game.shortName
  const displayTitle = canShorten && useShortTitle ? (game.shortName as string) : game.title

  // The Middle row is a carousel over the game's registered images, centred on
  // whichever one is currently applied as the thumbnail. A thumbnail set from
  // the Add Game dialog never went through the gallery, so fold it in.
  useEffect(() => {
    let cancelled = false
    // Seeding the slots is not a step through the carousel, so it must not
    // animate: the transition is switched off until the new positions have
    // been painted once.
    setAnimated(false)
    window.library.listGameImages(game.id).then((list) => {
      if (cancelled) return
      const paths = list.map((image) => image.filePath)
      if (game.thumbnailPath && !paths.includes(game.thumbnailPath)) {
        paths.unshift(game.thumbnailPath)
      }
      setCarousel(paths)
      setImageIndex(Math.max(0, game.thumbnailPath ? paths.indexOf(game.thumbnailPath) : 0))
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) setAnimated(true)
        })
      )
    })
    return () => {
      cancelled = true
    }
  }, [game.id, game.thumbnailPath])

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

  const imageCount = carousel.length
  // Slots are keyed by an ever-increasing virtual index rather than by their
  // offset, so stepping keeps each element alive and only changes its
  // transform — which is what the slide/scale transition animates.
  const slots = imageCount > 1 ? SLOT_OFFSETS : [0]

  function stepImage(direction: 1 | -1): void {
    if (imageCount > 1) setImageIndex((i) => i + direction)
  }

  function beginEdit(): void {
    const { hours, minutes } = splitPlaytime(game.stats.totalPlaySeconds)
    setDraft({ hours: String(hours), minutes: String(minutes) })
    committedRef.current = false
    setEditing(true)
  }

  function commitEdit(): void {
    // Enter and the focus leaving the editor can both land here; only the
    // first one should reach the database.
    if (committedRef.current) return
    committedRef.current = true
    const hours = Number(draft.hours || 0)
    const minutes = Number(draft.minutes || 0)
    setEditing(false)
    onEditPlayTime(game.id, hours * 3600 + minutes * 60)
  }

  /** Commit when focus leaves the editor entirely, but not when it moves
      between the hours and minutes fields. */
  function onEditorBlur(e: React.FocusEvent<HTMLElement>): void {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitEdit()
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

      {/* Penpot: Middle — 1585x610. The Sub Image frames are the row's own left
          and right edges cutting off the neighbouring carousel entries. */}
      <div className="game-middle">
        <div className={`carousel ${animated ? '' : 'instant'}`}>
          {slots.map((offset) => {
            const virtual = imageIndex + offset
            const src = imageCount
              ? carousel[((virtual % imageCount) + imageCount) % imageCount]
              : null
            const center = offset === 0
            return (
              <div
                key={`${game.id}:${virtual}`}
                className={`carousel-item ${center ? 'center' : 'side'}`}
                style={{ transform: slotTransform(offset) }}
              >
                <div className={`main-image ${center ? '' : 'side'}`}>
                  {src ? <img src={mediaUrl(src)} alt={center ? game.title : ''} /> : null}

                  {center ? (
                    /* Revealed at 50% while the image is hovered — or parked in
                       the middle for good when the game has no images at all. */
                    <button
                      className={`main-image-setting ${imageCount === 0 ? 'centered' : ''}`}
                      onClick={onOpenThumbnails}
                      title="画像を追加 / サムネイルを変更"
                      aria-label="画像を追加 / サムネイルを変更"
                    >
                      <i className="fa-solid fa-gear" />
                    </button>
                  ) : (
                    <button
                      className="carousel-side-hit"
                      onClick={() => stepImage(offset < 0 ? -1 : 1)}
                      aria-label={offset < 0 ? '前の画像' : '次の画像'}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <button
          className="nav-arrow prev"
          onClick={() => stepImage(-1)}
          disabled={imageCount <= 1}
          aria-label="前の画像"
        >
          <svg viewBox="0 0 43.29 86.58">
            <path d="M43.29,0 L43.29,86.58 L0,43.29 Z" fill="#B1B2B5" />
          </svg>
        </button>

        <button
          className="nav-arrow next"
          onClick={() => stepImage(1)}
          disabled={imageCount <= 1}
          aria-label="次の画像"
        >
          <svg viewBox="0 0 43.29 86.58">
            <path d="M0,0 L0,86.58 L43.29,43.29 Z" fill="#B1B2B5" />
          </svg>
        </button>
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
              <span className="stat-value stat-edit" onBlur={onEditorBlur}>
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

          <div className="stat last-played">
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
