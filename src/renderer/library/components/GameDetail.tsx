import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GameWithStats, ProgressState, Route, Tag } from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import { useContextMenuDismiss } from '../context-menu'
import { formatLastPlayed, formatPlaytime, splitPlaytime } from '../format'
import { GEAR_PATH, GEAR_VIEW_BOX } from '../gear'
import { formatShare, shareInk } from '../route-share'
import { useWheelStepper } from '../useWheelStepper'
import PlayButtonExtend from './PlayButtonExtend'
import ContextMenu from './ContextMenu'
import ClearDialog from './ClearDialog'
import GameInfo from './GameInfo'
import PlayLog from './PlayLog'
import RoutePanel from './RoutePanel'
import TagChip from './TagChip'
import './GameDetail.css'

interface Props {
  game: GameWithStats
  /** The vocabulary, which is what names the tags the game is filed under. */
  tags: Tag[]
  isPlaying: boolean
  onLaunch: (opts: { recordTime: boolean; useRecorderPanel: boolean; runAsAdmin: boolean }) => void
  onEditPlayTime: (gameId: number, seconds: number) => void
  /** Opens the Add Thumbnail screen for this game. */
  onOpenThumbnails: () => void
  /** Writes what the Progress triangle reads. */
  onSetProgress: (gameId: number, state: ProgressState | null, score: number | null) => void
  /** Runs the finale — confetti and balloons — over the whole window. */
  onCelebrate: (celebrating: boolean) => void
  /** Runs confetti1 in the finale's place, for a route marked cleared. */
  onCelebrateRoute: () => void
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
/* The ROUTE frame's own box inside "Under" — see `.route-button`. The Route
   board hangs off its top edge, so the panel's bottom is measured from the
   row's bottom rather than its top. */
const UNDER_HEIGHT = 177
const ROUTE_TOP = 56
/** The rule drawn between two neighbouring routes. */
const ROUTE_BAR_RULE = 3
/** The narrowest length that can hold its own share - the widest figure the
    bar writes, "25.2%", set in the board's own 26px, with a margin either
    side. Anything under it carries its colour alone. */
const ROUTE_BAR_SHARE_MIN = 66
const MIN_RECESS = ROUTE_MAX_WIDTH * 0.5 + ROUTE_SIDE_GAP

/* Penpot "Game Info" is 446 wide and carries its circle-info mark 15px in from
   its left edge; GameDetail hangs it off the title's mark, so a title long
   enough to push 446 - 15 past the content column flips the board onto the
   mark at its other end instead. */
const INFO_WIDTH = 446
const INFO_MARK_INSET = 15

/* Carousel geometry, all from Penpot's "Middle": the Main Image is 1084x610 at
   x=250.5, and each Sub Image is a 142px window at the row's outer edge. A
   neighbour drawn at 467/610 of full size and slid 1065.5px lands its edge
   exactly on that window — and its height on the design's 467 — so the row's
   own overflow does the cutting and no separate Sub Image frame is needed.
   The Main Image is drawn 5% over the design (1138.2x640.5, see
   GameDetail.css), so the scale is taken off the grown height to leave the Sub
   Image frames exactly as designed: 467 tall, 830 wide, 1065.5px out — the
   entry's centre line did not move, so the shift is unchanged. */
const SIDE_SCALE = 467 / 640.5
const SIDE_SHIFT = 1065.5
/* One item width further out again, i.e. clear of the row. */
const OFF_SHIFT = SIDE_SHIFT + 830
const SLOT_OFFSETS = [-2, -1, 0, 1, 2]

/* Not in the design: the mark the Progress triangle carries. The incentre of
   the 265x246 triangle — (190.3, 74.7), the point equidistant from all three
   edges — leaves a turned mark the most room, but reads as crowded into the
   corner; the centroid is a little down and in from it and still clears every
   edge at the sizes used (measured). */
const PROGRESS_MARK_X = (0 + 265 + 265) / 3
const PROGRESS_MARK_Y = (0 + 246 + 0) / 3

/**
 * What the triangle reads. A game the player has set by hand keeps that;
 * otherwise it follows the Play log — nothing launched and nothing on the clock
 * is 未, anything else is 途. Cleared is only ever set by hand, and shows the
 * score it was given, or 完 when it was cleared without one.
 */
function progressMark(game: GameWithStats): { text: string; scored: boolean } {
  const played = game.stats.hasSessions || game.stats.totalPlaySeconds > 0
  const state = game.progressState ?? (played ? 'playing' : 'unplayed')
  if (state === 'cleared') {
    return game.clearScore === null
      ? { text: '完', scored: false }
      : { text: String(game.clearScore), scored: true }
  }
  return { text: state === 'playing' ? '途' : '未', scored: false }
}

function slotTransform(offset: number): string {
  if (offset === 0) return 'translateX(0) scale(1)'
  const shift = (Math.abs(offset) === 1 ? SIDE_SHIFT : OFF_SHIFT) * Math.sign(offset)
  return `translateX(${shift}px) scale(${SIDE_SCALE})`
}

export default function GameDetail({
  game,
  tags,
  isPlaying,
  onLaunch,
  onEditPlayTime,
  onOpenThumbnails,
  onSetProgress,
  onCelebrate,
  onCelebrateRoute
}: Props): React.JSX.Element {
  const lastPlayed = formatLastPlayed(game.stats.lastPlayedAt)
  const detailRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const tagRowRef = useRef<HTMLDivElement | null>(null)
  const markerRef = useRef<HTMLSpanElement | null>(null)
  const underRef = useRef<HTMLDivElement | null>(null)
  const infoRef = useRef<HTMLDivElement | null>(null)
  const [useShortTitle, setUseShortTitle] = useState(false)
  const [infoWidth, setInfoWidth] = useState(782)
  const [carousel, setCarousel] = useState<string[]>([])
  const [imageIndex, setImageIndex] = useState(0)
  const [animated, setAnimated] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [infoFlipped, setInfoFlipped] = useState(false)
  // The Play log board slides in and back out, so it outlives the "open" flag
  // by one transition.
  const [playLogMounted, setPlayLogMounted] = useState(false)
  const [playLogOpen, setPlayLogOpen] = useState(false)
  const [routeOpen, setRouteOpen] = useState(false)
  // The board's own list, reported back up so the frame can graph it. It
  // carries the game it was read for, because this component outlives a switch
  // between games and the next game's list is a round trip away.
  const [routeList, setRouteList] = useState<{ gameId: number; routes: Route[] }>({
    gameId: -1,
    routes: []
  })
  const handleRoutes = useCallback((gameId: number, list: Route[]) => {
    setRouteList({ gameId, routes: list })
  }, [])
  const [progressMenu, setProgressMenu] = useState<{ x: number; y: number } | null>(null)
  const [scoring, setScoring] = useState<string | null>(null)
  const [draft, setDraft] = useState({ hours: '0', minutes: '0' })
  const committedRef = useRef(false)

  const canShorten = game.useShortName && !!game.shortName
  const displayTitle = canShorten && useShortTitle ? (game.shortName as string) : game.title

  /* The game carries its tags by id; the vocabulary is what names them, and the
     order is the row's own so the chips stand still as the list is read again. */
  const gameTags = tags.filter((tag) => game.tagIds.includes(tag.id))

  /* The row carries no scrollbar, so the wheel is the whole of how it moves.
     A vertical wheel over a box that only scrolls across does nothing in
     Chromium, and left alone it would take the Middle row's carousel a step
     instead — so the delta is turned sideways here and the event stopped.
     React's own `onWheel` is registered passive and cannot stop it, hence the
     native listener; it is re-hung when the row appears or goes. */
  useEffect(() => {
    const el = tagRowRef.current
    if (!el) return
    const onWheel = (event: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      if (delta === 0) return
      event.preventDefault()
      // Line and page deltas, which some mice report, in pixels.
      const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1
      el.scrollLeft += delta * scale
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gameTags.length])

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

  // Where the Game Info board would end if it hung off the title's mark to the
  // right. "Under" is exactly UNDER_WIDTH design px, so its rect recovers the
  // scale and the mark's position in the same design pixels the board is
  // drawn in.
  useLayoutEffect(() => {
    if (!showInfo) return
    const marker = markerRef.current
    const under = underRef.current
    if (!marker || !under) return
    const underRect = under.getBoundingClientRect()
    if (underRect.width <= 0) return
    const scale = underRect.width / UNDER_WIDTH
    const markerLeft = (marker.getBoundingClientRect().left - underRect.left) / scale
    setInfoFlipped(markerLeft - INFO_MARK_INSET + INFO_WIDTH > UNDER_WIDTH)
  }, [showInfo, displayTitle])

  // The Play log belongs to the game it was opened on, so switching games takes
  // it away outright rather than sliding it out from under the new one.
  useEffect(() => {
    setPlayLogOpen(false)
    setPlayLogMounted(false)
  }, [game.id])

  // Clicking anywhere that is neither the board nor the button that opened it
  // puts it away. `pointerdown` runs ahead of the button's own click, so the
  // button is excluded here rather than closing and reopening on one press.
  useEffect(() => {
    if (!playLogOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.play-log, .play-log-button')) return
      setPlayLogOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [playLogOpen])

  // The Route board is opened by the ROUTE frame, so it closes the same way the
  // Play log does: a `pointerdown` outside both of them, ahead of the frame's
  // own click so a press on the frame toggles instead of closing and reopening.
  useEffect(() => {
    if (!routeOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.route-panel, .route-button')) return
      setRouteOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [routeOpen])

  // Any click, a second right-click, or Escape puts the Progress menu away,
  // the way the side panel's own menu behaves.
  const progressOpener = useContextMenuDismiss(progressMenu !== null, () =>
    setProgressMenu(null)
  )

  /* `position: fixed` and the shell's design pixels are different spaces, so a
     client point is converted through the content column, which is exactly
     UNDER_WIDTH design px across. */
  function designPointWithin(clientX: number, clientY: number): { x: number; y: number } {
    const el = detailRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const scale = rect.width / UNDER_WIDTH
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
  }

  function setProgress(state: ProgressState, score: number | null): void {
    setProgressMenu(null)
    setScoring(null)
    // Clearing a game is the moment worth marking; the other two just put the
    // celebration away if the score field was up.
    onCelebrate(state === 'cleared')
    onSetProgress(game.id, state, score)
  }

  function togglePlayLog(): void {
    if (playLogOpen) {
      setPlayLogOpen(false)
      return
    }
    setPlayLogMounted(true)
    // Mount it parked off the right edge, then open on the next frame so the
    // slide has somewhere to come from.
    requestAnimationFrame(() => setPlayLogOpen(true))
  }

  const recessEnd = UNDER_WIDTH - UNDER_RISE
  const maxTopEnd = recessEnd - UNDER_DIAGONAL - MIN_RECESS
  const topEnd = Math.min(Math.max(INFO_LEFT_MARGIN + infoWidth - 5, 400), maxTopEnd)
  const recessStart = topEnd + UNDER_DIAGONAL
  const recessWidth = recessEnd - recessStart
  const routeWidth = Math.min(ROUTE_MAX_WIDTH, recessWidth - ROUTE_SIDE_GAP)
  const routeLeft = recessStart + (recessWidth - routeWidth) / 2
  // The frame narrows with the recess, which the play time and last-played
  // values drive; the Route board is always the full 416 and is placed on the
  // frame at its widest, i.e. centred on the recess like the frame itself.
  const routeMaxLeft = recessStart + (recessWidth - ROUTE_MAX_WIDTH) / 2
  const timedRoutes =
    routeList.gameId === game.id ? routeList.routes.filter((route) => route.playSeconds > 0) : []
  const routeTotal = timedRoutes.reduce((sum, route) => sum + route.playSeconds, 0)
  /* What is left of the frame once its border and the rules between the routes
     are out of it, so a length can be asked whether it has room for its own
     figure before it is written. */
  const routeBarWidth = routeWidth - 6 - ROUTE_BAR_RULE * Math.max(timedRoutes.length - 1, 0)

  const mark = progressMark(game)
  const imageCount = carousel.length
  // Slots are keyed by an ever-increasing virtual index rather than by their
  // offset, so stepping keeps each element alive and only changes its
  // transform — which is what the slide/scale transition animates.
  const slots = imageCount > 1 ? SLOT_OFFSETS : [0]

  function stepImage(direction: 1 | -1): void {
    if (imageCount > 1) setImageIndex((i) => i + direction)
  }

  const onCarouselWheel = useWheelStepper(stepImage)

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
    <section className="game-detail" ref={detailRef}>
      {/* Penpot: Top — 1585x197 */}
      <div className="game-top">
        <div className="game-titles">
          <div className="title-row">
            <h1 className="game-title" ref={titleRef} title={game.title}>
              {displayTitle}
            </h1>
            {/* Penpot draws a "◯" here and puts the same mark in the top-left
                of the Game Info board; the panel hangs off this one so the two
                land on each other. */}
            <span
              className="title-marker"
              ref={markerRef}
              onMouseEnter={() => setShowInfo(true)}
              onMouseLeave={() => setShowInfo(false)}
            >
              <i className="fa-solid fa-circle-info" />
              {showInfo && <GameInfo game={game} flipped={infoFlipped} />}
            </span>
          </div>

          {/* Penpot: Under Line — solid bar plus a 132x8 tapering triangle */}
          <div className="title-underline">
            <span className="title-underline-bar" />
            <svg className="title-underline-tail" viewBox="0 0 132 8" preserveAspectRatio="none">
              <path d="M0,0 L132,0 L0,8 Z" fill="#e1e8ed" />
            </svg>
          </div>

          {/* Not in the design: what the game is filed under, in the air the
              Top board already leaves under the rule. They are the side panel's
              own chips with nothing to take away, so no ✕. */}
          {gameTags.length > 0 && (
            <div className="game-tags" ref={tagRowRef}>
              {gameTags.map((tag) => (
                <TagChip key={tag.id} name={tag.name} />
              ))}
            </div>
          )}
        </div>

        {/* Penpot: Progress — 265x246 triangle, fill #1da1f2, stroke #e1e8ed 3px
            inner. Not in the design: the mark it carries and the menu that
            sets it. The board is clipped to the triangle, which is what makes
            the hover and the right-click land on the blue and nowhere else —
            and what turns the 6px centred stroke into the design's 3px inner
            one. */}
        <div
          className="game-progress"
          onContextMenu={(event) => {
            event.preventDefault()
            // The triangle is what a second right-click on it toggles off.
            progressOpener.current = event.currentTarget
            setProgressMenu(designPointWithin(event.clientX, event.clientY))
          }}
          title="右クリックで進行状況を変更"
        >
          <svg className="game-progress-shape" viewBox="0 0 265 246" preserveAspectRatio="none">
            <path
              d="M0,0 L265,246 L265,0 Z"
              fill="#1da1f2"
              stroke="#e1e8ed"
              strokeWidth="6"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span
            className={`progress-mark ${mark.scored ? 'scored' : ''} ${
              mark.text.length > 2 ? 'wide' : ''
            }`}
            style={{ left: `${PROGRESS_MARK_X}px`, top: `${PROGRESS_MARK_Y}px` }}
          >
            {mark.text}
          </span>
        </div>
      </div>

      {/* Penpot: Middle — 1585x610. The Sub Image frames are the row's own left
          and right edges cutting off the neighbouring carousel entries. */}
      <div className="game-middle" onWheel={onCarouselWheel}>
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
                <div
                  className={`main-image ${
                    center ? '' : `side ${offset < 0 ? 'side-left' : 'side-right'}`
                  }`}
                >
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
                      <svg viewBox={GEAR_VIEW_BOX} aria-hidden="true">
                        <path d={GEAR_PATH} />
                      </svg>
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
        <button
          type="button"
          className={`route-button ${routeOpen ? 'open' : ''} ${
            timedRoutes.length > 0 ? 'charted' : ''
          }`}
          style={{ left: `${routeLeft}px`, width: `${routeWidth}px` }}
          title="Route"
          aria-label="Route"
          aria-expanded={routeOpen}
          onClick={() => setRouteOpen((open) => !open)}
        >
          {/* Not in the design: what the Route board's own chart says, laid out
              flat over the whole frame. One length per route with time on it,
              in the board's order and its colours, so the two read as the same
              figure. The lengths are flex-grow rather than widths, which leaves
              the seams their own space, and a route too short to see keeps a
              floor the way the wedges do. The design's lettering is what the
              frame says while no route has time yet. */}
          {timedRoutes.length > 0 ? (
            <span className="route-bar">
              {timedRoutes.map((route) => {
                const share = route.playSeconds / routeTotal
                return (
                  <span
                    key={route.id}
                    className="route-bar-part"
                    style={{ flexGrow: route.playSeconds, backgroundColor: route.color }}
                    title={`${route.name}  ${formatPlaytime(route.playSeconds)}`}
                  >
                    {share * routeBarWidth >= ROUTE_BAR_SHARE_MIN ? (
                      <span className="route-bar-share" style={{ color: shareInk(route.color) }}>
                        {formatShare(share)}
                      </span>
                    ) : null}
                  </span>
                )
              })}
            </span>
          ) : (
            <span>route</span>
          )}
        </button>

        {/* Penpot: Route — stands on the ROUTE frame's top edge while the frame
            is pressed. Kept mounted so it can fade rather than appear. */}
        <RoutePanel
          gameId={game.id}
          left={routeMaxLeft}
          bottom={UNDER_HEIGHT - ROUTE_TOP}
          open={routeOpen}
          onCelebrate={onCelebrateRoute}
          onRoutes={handleRoutes}
        />

        {/* Penpot: Play Log Button — 77x76; opens the Play log board */}
        <button
          className={`play-log-button ${playLogOpen ? 'open' : ''}`}
          onClick={togglePlayLog}
          title="Play Log"
          aria-label="Play Log"
          aria-pressed={playLogOpen}
        >
          <i className="fa-solid fa-file-lines" />
        </button>
      </div>

      {progressMenu && (
        <ContextMenu
          style={{ right: `${UNDER_WIDTH - progressMenu.x}px`, top: `${progressMenu.y}px` }}
          items={[
            { label: '未プレイ表記に変更', onSelect: () => setProgress('unplayed', null) },
            { label: 'プレイ途中表記に変更', onSelect: () => setProgress('playing', null) },
            {
              label: 'クリア状態にする',
              onSelect: () => {
                setProgressMenu(null)
                setScoring(game.clearScore === null ? '' : String(game.clearScore))
              }
            }
          ]}
        />
      )}

      {scoring !== null && (
        <ClearDialog
          initialScore={scoring}
          onCancel={() => setScoring(null)}
          onConfirm={(score) => setProgress('cleared', score)}
        />
      )}

      {playLogMounted && (
        <PlayLog game={game} open={playLogOpen} onClosed={() => setPlayLogMounted(false)} />
      )}

      {isPlaying && <div className="playing-badge">プレイ中…</div>}
    </section>
  )
}
