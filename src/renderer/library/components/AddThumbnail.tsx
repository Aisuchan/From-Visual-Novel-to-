import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameImage, GameWithStats } from '../../../shared/db-types'
import { mediaUrl } from '../../../shared/media-url'
import { WHEEL_NOTCH, useWheelStepper } from '../useWheelStepper'
import ConfirmDialog from './ConfirmDialog'
import './AddThumbnail.css'

interface Props {
  game: GameWithStats
  onCancel: () => void
  onApplied: () => void
  /** Deleting an image can clear the game's thumbnail, so the list is reread. */
  onGamesChanged: () => void
}

/* Penpot: Image Container — a 5x5 grid of 273x154 cells, so 25 images a page.
   The grid pages through `game_images` in insertion order, which keeps page
   numbers stable as images are added. */
const COLUMNS = 5
const ROWS = 5
const PAGE_SIZE = COLUMNS * ROWS

/** Delay between the diagonals the pictures flip in along, in milliseconds. */
const FLIP_STAGGER = 55

/* The board's own fade-in (`board-fade-in` at `.slow-fade`'s duration, in
   App.css) is what covers the read and the decode. The flip waits it out
   rather than running through it: a grid of 3D-transformed pictures inside a
   layer that is still being composited at a changing opacity is what made the
   flip flicker. */
const FADE_COVER_MS = 500

/* The viewer steps like the Middle row's carousel: the arriving picture grows
   as it slides in, the leaving one shrinks as it slides out. Both side slots
   sit a whole stage away, i.e. clear of it. */
const VIEWER_SLOTS = [-1, 0, 1]
const VIEWER_SIDE_SCALE = 0.766

function viewerSlotTransform(offset: number): string {
  if (offset === 0) return 'translateX(0) scale(1)'
  return `translateX(${offset * 110}%) scale(${VIEWER_SIDE_SCALE})`
}

/**
 * The page strip the design draws is "1 ⋯ 49 [50] 51 ⋯ 99": the first page,
 * the current page with its two neighbours, the last page, and an ellipsis
 * wherever that skips something.
 */
function pageItems(current: number, pageCount: number): (number | 'gap')[] {
  const pages = new Set<number>([1, pageCount, current - 1, current, current + 1])
  const shown = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b)

  const items: (number | 'gap')[] = []
  shown.forEach((page, index) => {
    if (index > 0 && page - shown[index - 1] > 1) items.push('gap')
    items.push(page)
  })
  return items
}

export default function AddThumbnail({
  game,
  onCancel,
  onApplied,
  onGamesChanged
}: Props): React.JSX.Element {
  const [images, setImages] = useState<GameImage[]>([])
  // "no images yet" is a verdict, not a waiting state: it stays off until the
  // list has actually come back.
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [deleting, setDeleting] = useState<GameImage | null>(null)
  // Index into `images` of the picture shown full screen, if any.
  const [viewing, setViewing] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const wheelAccum = useRef(0)
  const turnedBack = useRef(false)
  // Pictures Chromium has already decoded once. Decoding a page's worth of
  // them is what stalls the very frame the flip-in starts on the first time a
  // page is opened, so the flip is held back until they are decoded: the
  // animation itself is untouched, it just no longer competes with the decode.
  const decoded = useRef(new Set<string>())
  // What the selection falls back to when a click turns out to be a double.
  const restoreSelection = useRef<number | null>(null)
  const [, setDecodedPass] = useState(0)
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setFaded(true), FADE_COVER_MS)
    return () => window.clearTimeout(id)
  }, [])

  // Start on the image that is already applied as the thumbnail, and open on
  // the page holding it rather than burying the current choice pages in.
  const load = useCallback(
    async (focusPath: string | null): Promise<void> => {
      const list = await window.library.listGameImages(game.id)
      setImages(list)
      setLoaded(true)
      const index = focusPath ? list.findIndex((image) => image.filePath === focusPath) : -1
      setSelectedId(index >= 0 ? list[index].id : null)
      setPage(index >= 0 ? Math.floor(index / PAGE_SIZE) + 1 : 1)
    },
    [game.id]
  )

  useEffect(() => {
    load(game.thumbnailPath)
  }, [load, game.thumbnailPath])

  const pageCount = Math.max(1, Math.ceil(images.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const visible = images.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const ready = faded && visible.every((image) => decoded.current.has(image.filePath))
  const visibleKey = visible.map((image) => image.id).join(',')

  useEffect(() => {
    if (visible.every((image) => decoded.current.has(image.filePath))) return
    let cancelled = false
    void Promise.all(
      visible.map(async (image) => {
        const preload = new Image()
        preload.src = mediaUrl(image.filePath)
        // One that fails to load must not hold the rest of the page back.
        await preload.decode().catch(() => undefined)
        decoded.current.add(image.filePath)
      })
    ).then(() => {
      if (!cancelled) setDecodedPass((pass) => pass + 1)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, ready])

  // A page turn lands at the edge the reader came from, so a continued scroll
  // reads on rather than immediately turning back.
  useEffect(() => {
    const el = gridRef.current
    if (el) el.scrollTop = turnedBack.current ? el.scrollHeight : 0
    turnedBack.current = false
  }, [current])

  /**
   * The wheel pages through the grid. A window too short for all five rows can
   * still scroll: the page only turns once the grid has run out in that
   * direction.
   *
   * Pages are counted out of the distance scrolled rather than rate-limited, so
   * spinning fast turns pages as fast as the wheel is turned — while a
   * trackpad's small deltas still have to add up to a notch's worth first.
   */
  function onWheel(event: React.WheelEvent<HTMLDivElement>): void {
    const el = event.currentTarget
    const forward = event.deltaY > 0
    const canScroll = forward
      ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
      : el.scrollTop > 0
    if (canScroll || event.deltaY === 0) return

    // Normalise the line and page delta modes to pixels.
    const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1
    const delta = event.deltaY * scale
    // A change of direction starts the count again rather than cancelling out.
    const accumulated = wheelAccum.current * delta > 0 ? wheelAccum.current + delta : delta

    const steps = Math.trunc(accumulated / WHEEL_NOTCH)
    if (steps === 0) {
      wheelAccum.current = accumulated
      return
    }
    wheelAccum.current = 0

    const target = Math.min(Math.max(current + steps, 1), pageCount)
    if (target === current) return
    turnedBack.current = target < current
    setPage(target)
  }

  async function addImages(): Promise<void> {
    const before = images.length
    const list = await window.library.addGameImages(game.id)
    setImages(list)
    // Land on the page the first newly added image went to, but leave the
    // selection — and so the applied thumbnail — where it was.
    if (list.length > before) setPage(Math.floor(before / PAGE_SIZE) + 1)
  }

  // The index is left unbounded so each slot keeps a distinct key across a
  // step, which is what lets the transition run instead of remounting.
  const stepViewer = useCallback(
    (direction: 1 | -1): void =>
      setViewing((index) => (index === null || images.length === 0 ? index : index + direction)),
    [images.length]
  )

  const onViewerWheel = useWheelStepper(stepViewer)

  useEffect(() => {
    if (viewing === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setViewing(null)
      else if (event.key === 'ArrowLeft') stepViewer(-1)
      else if (event.key === 'ArrowRight') stepViewer(1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [viewing, stepViewer])

  async function confirmDelete(): Promise<void> {
    if (!deleting) return
    const remaining = await window.library.deleteGameImage(game.id, deleting.id)
    setImages(remaining)
    if (selectedId === deleting.id) setSelectedId(null)
    setDeleting(null)
    setViewing(null)
    onGamesChanged()
  }

  async function apply(): Promise<void> {
    const image = images.find((candidate) => candidate.id === selectedId)
    if (!image) return
    await window.library.setThumbnail(game.id, image.filePath)
    onApplied()
  }

  return (
    <section className="add-thumbnail">
      {/* Penpot: Image Container — 1585x885, 35px top / 50px side padding */}
      <div className="thumb-container" ref={gridRef} onWheel={onWheel}>
        {!loaded ? null : images.length === 0 ? (
          <p className="thumb-empty">no images yet — use ADD IMAGE</p>
        ) : (
          <div className={`thumb-grid${ready ? ' is-ready' : ''}`}>
            {visible.map((image, index) => (
              <div
                key={image.id}
                className={`thumb-cell ${selectedId === image.id ? 'selected' : ''}`}
              >
                {/* One click selects, two open it full screen. */}
                <button
                  className="thumb-cell-image"
                  onClick={(event) => {
                    // `detail` is the platform's own click count, so only the
                    // opening click of a double ever moves the selection.
                    if (event.detail !== 1) return
                    restoreSelection.current = selectedId
                    setSelectedId(image.id)
                  }}
                  onDoubleClick={() => {
                    // Opening a picture full screen is not choosing it.
                    setSelectedId(restoreSelection.current)
                    setViewing(images.findIndex((i) => i.id === image.id))
                  }}
                  aria-pressed={selectedId === image.id}
                >
                  {/* Flips in along the grid's anti-diagonals: top-left first,
                      then the pair below/right of it, and so on. */}
                  <img
                    src={mediaUrl(image.filePath)}
                    alt=""
                    decoding="async"
                    style={{
                      animationDelay: `${
                        (Math.floor(index / COLUMNS) + (index % COLUMNS)) * FLIP_STAGGER
                      }ms`
                    }}
                  />
                </button>

                <button
                  className="thumb-cell-delete"
                  onClick={() => setDeleting(image)}
                  title="この画像を削除"
                  aria-label="この画像を削除"
                >
                  <i className="fa-solid fa-trash" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Penpot: Bottom — 1585x99, row-reverse, 30px gap, 50px side padding */}
      <div className="thumb-bottom">
        {/* Penpot: Buttons — 1182x61, 30px gap */}
        <div className="thumb-buttons">
          <button className="thumb-button add-image" onClick={addImages}>
            ADD IMAGE
          </button>
          <button
            className="thumb-button apply"
            onClick={apply}
            disabled={selectedId === null}
            title={selectedId === null ? '画像を選択してください' : undefined}
          >
            APPLY
          </button>
          <button className="thumb-button cancel" onClick={onCancel}>
            CANCEL
          </button>
        </div>

        {/* Penpot: Page Switcher — 273x44, 2px gap, centred */}
        <div className="thumb-pager">
          {pageItems(current, pageCount).map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} className="pager-gap">
                ⋯
              </span>
            ) : (
              <button
                key={item}
                className={`pager-page ${item === current ? 'selected' : ''}`}
                onClick={() => {
                  turnedBack.current = false
                  wheelAccum.current = 0
                  setPage(item)
                }}
              >
                {item}
              </button>
            )
          )}
        </div>
      </div>

      {viewing !== null && images.length > 0 && (
        <div
          className="image-viewer"
          onWheel={onViewerWheel}
          onClick={(e) => {
            // Anywhere but the picture itself and the controls closes it.
            const target = e.target as HTMLElement
            if (target.tagName !== 'IMG' && !target.closest('button')) setViewing(null)
          }}
        >
          <div className="viewer-stage">
            {VIEWER_SLOTS.map((offset) => {
              const virtual = viewing + offset
              const image = images[((virtual % images.length) + images.length) % images.length]
              return (
                <div
                  key={virtual}
                  className="viewer-slot"
                  style={{ transform: viewerSlotTransform(offset) }}
                >
                  <img src={mediaUrl(image.filePath)} alt="" />
                </div>
              )
            })}
          </div>

          <button
            className="viewer-arrow prev"
            onClick={() => stepViewer(-1)}
            disabled={images.length <= 1}
            aria-label="前の画像"
          >
            <svg viewBox="0 0 43.29 86.58">
              <path d="M43.29,0 L43.29,86.58 L0,43.29 Z" fill="#B1B2B5" />
            </svg>
          </button>

          <button
            className="viewer-arrow next"
            onClick={() => stepViewer(1)}
            disabled={images.length <= 1}
            aria-label="次の画像"
          >
            <svg viewBox="0 0 43.29 86.58">
              <path d="M0,0 L0,86.58 L43.29,43.29 Z" fill="#B1B2B5" />
            </svg>
          </button>

          <button
            className="viewer-back"
            onClick={() => setViewing(null)}
            title="一覧に戻る"
            aria-label="一覧に戻る"
          >
            <i className="fa-solid fa-angles-left" />
          </button>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="delete image"
          message="この画像を削除しますか？"
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  )
}
