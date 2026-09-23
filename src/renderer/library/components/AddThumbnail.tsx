import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GameImage, GameWithStats } from '../../../shared/db-types'
import {
  GALLERY_IMAGE_EXTENSIONS,
  GALLERY_VIDEO_EXTENSIONS,
  isVideoPath,
  mediaUrl
} from '../../../shared/media-url'
import { WHEEL_NOTCH, useWheelStepper } from '../useWheelStepper'
import ConfirmDialog from './ConfirmDialog'
import ContextMenu from './ContextMenu'
import { useContextMenuDismiss } from '../context-menu'
import { motionOff } from '../motion'
import './AddThumbnail.css'
import { t } from '../../../shared/i18n'

interface Props {
  game: GameWithStats
  /* Both carry the picture the Game board's carousel should open on when it
     comes back: CANCEL the one that was the Main Image when the board opened,
     APPLY the first picture added this time, or — nothing having been added —
     the Main Image as it now stands. Null centres on the thumbnail as before. */
  onCancel: (focusPath: string | null) => void
  onApplied: (focusPath: string | null) => void
  /** Deleting an image can clear the game's thumbnail, so the list is reread. */
  onGamesChanged: () => void
  /** A picture to open full screen as the board arrives — the Extra Function
      board's blue circle lands here on one drawn at random. Read once, on
      the first list; the viewer is the reader's after that. */
  openImageId?: number | null
  /** The picture the Game board's carousel was on when this board was opened,
      which is where CANCEL sends it back. */
  openedFrom?: string | null
}

/* Penpot: Image Container — a 5x5 grid of 273x154 cells, so 25 images a page.
   The grid pages through `game_images` in insertion order, which keeps page
   numbers stable as images are added. */
const COLUMNS = 5
const ROWS = 5

/** Penpot: the content column's own width, which the right-click menu's
    placement is measured off the way every other menu in the app is. */
const BOARD_WIDTH = 1585
const PAGE_SIZE = COLUMNS * ROWS

/* Penpot's own cell and the gaps between them, which `AddThumbnail.css` draws
   the grid with. The drag works its target slot out of these rather than out of
   where the cells are: a cell that is sliding into its new place is *moving*,
   and a moving box under a still pointer is what made the order shake. */
const CELL_WIDTH = 273
const CELL_HEIGHT = 154
const COLUMN_GAP = 30
const ROW_GAP = 20
const GRID_WIDTH = COLUMNS * CELL_WIDTH + (COLUMNS - 1) * COLUMN_GAP

/* **A picture is carried onto another page by holding it at the edge.** The
   band is a little wider than the 50 the Image Container has of its own
   padding, so it begins where the pictures end rather than at the very edge of
   the board; a pointer that has run out of grid is already asking for the next
   page. Held there, the first page turns after `EDGE_HOLD_MS` and each one
   after that at `EDGE_REPEAT_MS` — long enough to read a page before the next
   one comes, and short enough not to have to wait for it. */
const EDGE_BAND = 60
const EDGE_HOLD_MS = 500
const EDGE_REPEAT_MS = 700

/** Delay between the diagonals the pictures flip in along, in milliseconds. */
const FLIP_STAGGER = 55
/** How long the flip itself takes; the same figure as `thumb-flip-in`'s. */
const FLIP_MS = 300
/** The whole arrival: the last diagonal's wait — a 5x5 grid has eight of them
    past the first — and the flip that follows it. */
const FLIP_TOTAL_MS = (COLUMNS - 1 + ROWS - 1) * FLIP_STAGGER + FLIP_MS

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
  onGamesChanged,
  openImageId = null,
  openedFrom = null
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
  /* What the board has changed and not yet written (see `apply`): the pictures
     staged for deletion, which are off the list but still in the library, and
     the ids of the ones added, which are in the library and come out again
     on CANCEL. `openedOrder` is the list as the board found it, which is what
     says whether the order has changed. */
  const [removed, setRemoved] = useState<GameImage[]>([])
  const [added, setAdded] = useState<number[]>([])
  const addedRef = useRef<number[]>([])
  addedRef.current = added
  /* The latest `game.id` and `onGamesChanged`, kept in refs so the unmount
     cleanup can read them without `discardAdded` depending on them. The parent
     passes a fresh `onGamesChanged` (an unmemoised `refreshGames`) on every one
     of its renders, and a `discardAdded` that changed identity with it made the
     `[discardAdded]` cleanup below run on every parent render rather than only
     on unmount — silently deleting this session's added pictures, files and all,
     while the board stood open. Read through refs, `discardAdded` is stable and
     the cleanup fires only when the board is actually left. */
  const onGamesChangedRef = useRef(onGamesChanged)
  onGamesChangedRef.current = onGamesChanged
  const gameIdRef = useRef(game.id)
  gameIdRef.current = game.id
  const openedOrder = useRef<number[]>([])
  /** True once APPLY or CANCEL has answered for the board's edits. */
  const committed = useRef(false)
  /** `openImageId` as the board arrived, spent on the first list. */
  const openOnce = useRef<number | null>(openImageId)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const wheelAccum = useRef(0)
  const turnedBack = useRef(false)
  // Pictures Chromium has already decoded once. Decoding a page's worth of
  // them is what stalls the very frame the flip-in starts on the first time a
  // page is opened, so the flip is held back until they are decoded: the
  // animation itself is untouched, it just no longer competes with the decode.
  const decoded = useRef(new Set<string>())
  const [, setDecodedPass] = useState(0)
  /* True from the first frame while the Setting board's アニメーション row is
     off: what this waits out is the board's own fade, and there is not one. */
  const [faded, setFaded] = useState(() => motionOff())
  /* Where a right-click landed, in the board's own design pixels, and which
     picture it landed on. */
  /* The menu holds the pointer it was opened at, in the board's own design
     pixels; where the plate actually lands is worked out once it has been drawn
     and measured (`menuXY`), since its width is its longest label's and not a
     constant — a Japanese row runs well past the design's 201. */
  const [menu, setMenu] = useState<{ image: GameImage; px: number; py: number } | null>(null)
  const [menuXY, setMenuXY] = useState<{ x: number; y: number } | null>(null)
  const menuOpener = useContextMenuDismiss(menu !== null, () => setMenu(null))

  /* Placed after it is drawn: the plate's real size is measured (`offsetWidth`
     is the unzoomed design pixel the position is in), and it opens to the left
     of the pointer when it would otherwise run off the right, and is held inside
     the board top and bottom. */
  useLayoutEffect(() => {
    if (!menu) {
      setMenuXY(null)
      return
    }
    const section = sectionRef.current
    const plate = section?.querySelector('.context-menu') as HTMLElement | null
    if (!section || !plate) return
    const rect = section.getBoundingClientRect()
    if (rect.width <= 0) return
    const scale = rect.width / BOARD_WIDTH
    const boardHeight = rect.height / scale
    const w = plate.offsetWidth
    const h = plate.offsetHeight
    setMenuXY({
      x: Math.max(0, menu.px + w > BOARD_WIDTH ? menu.px - w : menu.px),
      y: Math.max(0, Math.min(menu.py, boardHeight - h))
    })
  }, [menu])
  /* What the menu is positioned in, and therefore what its pointer position is
     measured against: the two have to be the same box. The grid inside it
     scrolls, so it is the section rather than the container. */
  const sectionRef = useRef<HTMLElement | null>(null)
  /* **The grid is dragged into the order it is read in.** Which picture is
     being carried, and the page's own ids in the order they currently stand —
     the cells swap under the pointer and only the release writes anything, the
     way the side panel's rows do.

     It is the *page* that is reordered rather than the gallery: a drag is over
     the cells that can be seen, and 25 of them is what a page is. What is
     written back is still the whole list, with the page's slots refilled in
     their new order — exactly what the side panel does when a filter is
     narrowing it. */
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOrder, setDragOrder] = useState<number[] | null>(null)
  /* A press on a cell opens the picture and a drag reorders it, and the two
     are the same gesture until the pointer moves. This holds where the press
     landed until it has moved far enough to be a drag; once it has, the click
     that follows the release is the drag's own and is swallowed. */
  const pressed = useRef<{ id: number; x: number; y: number } | null>(null)
  const dragged = useRef(false)
  /* The frame the carried picture belongs to. It stays in its slot the whole
     drag, so its own box is what the picture's offset is measured against —
     and it moves with the reorder, which is what keeps the offset right after
     the cell has changed places. */
  /* **The flip is a page arriving, and nothing else is one.** It used to be
     hung on `is-ready` alone, which stands for the whole time the page can be
     seen — so every render that moved a picture re-ran it: an `animation-delay`
     written from the cell's index is changed by a reorder, and a finished
     animation whose delay moves re-enters its own active phase and plays
     again. What arrives is the page, so this is turned on when the page does
     and turned off once the last diagonal has landed; `is-ready` goes on doing
     what it always did, which is to say the pictures may be turned face up. */
  const [arriving, setArriving] = useState(false)
  /* Whether a file drag from the file manager is over the board — draws the
     drop hint and nothing else. Internal cell reordering is pointer-driven, not
     a native drag, so the two never meet. */
  const [dragOver, setDragOver] = useState(false)
  /* **Which picture is being carried, looked up rather than held.** The frame
     it belongs to is what its offset is measured against, and that frame is
     found by its id every time it is wanted: a page turned mid-drag draws a
     different twenty-five, so the cell the picture is in is a *different
     element* on the other side of the turn, and an element held onto from
     before the turn is one no longer in the document — which is where the
     picture stopped following the pointer. */
  const carriedId = useRef<number | null>(null)
  /* Where in the cell the picture was taken hold of, in design pixels. Read on
     the first frame the cell is actually carried rather than at the press: the
     cell is under the pointer, so at the press it still has the hover's own
     1.04 on it and its box is not the slot's. */
  const grab = useRef<{ x: number; y: number } | null>(null)
  /** Where the pointer last was, so the picture can be put under it again on a
      frame the pointer itself did not move. */
  const pointerAt = useRef<{ x: number; y: number } | null>(null)
  /* Where each cell stood before the swap, in the grid's own design pixels
     (`offsetLeft`/`offsetTop`, which are the *layout* position and so are not
     moved by the transform a cell may still be sliding under). It is what the
     slide below is worked out from. */
  const cellHome = useRef(new Map<number, { left: number; top: number }>())
  /* Which edge the carried picture is being held at, and the timer that is
     turning pages for as long as it is. It is a timer rather than something
     the moves drive: a pointer standing still at the edge sends none. */
  const edge = useRef<{ side: -1 | 1; timer: number } | null>(null)

  useEffect(() => {
    if (motionOff()) return
    const id = window.setTimeout(() => setFaded(true), FADE_COVER_MS)
    return () => window.clearTimeout(id)
  }, [])

  /* A board closed mid-drag leaves nothing running behind it. */
  useEffect(
    () => () => {
      if (edge.current) {
        window.clearTimeout(edge.current.timer)
        window.clearInterval(edge.current.timer)
      }
    },
    []
  )

  // Start on the image that is already applied as the thumbnail, and open on
  // the page holding it rather than burying the current choice pages in.
  /* The thumbnail the board opens focused on, read through a ref so that a later
     change to it does not reload the list. `load` resetting `images` and
     `openedOrder` is exactly the board's staged state (a reorder, a deletion),
     so a reload triggered while the board is open would silently drop those and
     leave APPLY with nothing to write — the board only ever loads on the game
     it is for, once. Nothing changes the game's own thumbnail while the board is
     open (the menu's 「メインサムネイルに設定」 stages the mark rather than writing
     it), so there is nothing here to follow anyway. */
  const openThumb = useRef(game.thumbnailPath)
  openThumb.current = game.thumbnailPath
  const load = useCallback(async (): Promise<void> => {
    const focusPath = openThumb.current
    const list = await window.library.listGameImages(game.id)
    setImages(list)
    openedOrder.current = list.map((image) => image.id)
    setLoaded(true)
    const index = focusPath ? list.findIndex((image) => image.filePath === focusPath) : -1
    setSelectedId(index >= 0 ? list[index].id : null)
    setPage(index >= 0 ? Math.floor(index / PAGE_SIZE) + 1 : 1)
    /* The picture the board was opened *on*, if it was opened on one: put up
       full screen at once, with the page under it turned to where it is so
       that closing the viewer lands on the cell it came out of. */
    if (openOnce.current !== null) {
      const wanted = list.findIndex((image) => image.id === openOnce.current)
      openOnce.current = null
      if (wanted >= 0) {
        setViewing(wanted)
        setPage(Math.floor(wanted / PAGE_SIZE) + 1)
      }
    }
  }, [game.id])

  useEffect(() => {
    void load()
  }, [load])

  /** How far the pointer has to travel before a press is a drag rather than a
      click, in the window's own pixels. */
  const DRAG_THRESHOLD = 6

  const pageCount = Math.max(1, Math.ceil(images.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  /* **What the drag holds is the whole gallery's order, not the page's.** A
     picture is carried off the end of a page onto the next one, so the slot it
     is being put into is an index into the list rather than into the
     twenty-five that happen to be on the screen; the page is only which
     twenty-five of them are drawn. The list itself is not touched until the
     release. */
  const ordered = useMemo(() => {
    if (!dragOrder) return images
    const byId = new Map(images.map((image) => [image.id, image]))
    return dragOrder
      .map((id) => byId.get(id))
      .filter((image): image is GameImage => image !== undefined)
  }, [images, dragOrder])
  const visible = ordered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  /* The grid's pictures are turned face down until this is true, so it is what
     says the page may be seen. The decode is waited out only because the flip
     is: a page of pictures being decoded on the frame a 3D transform starts is
     what made it stutter. With the arrivals off there is no flip to protect,
     and holding a page of pictures back for a decode nobody is watching is the
     one thing the row is asked not to do. */
  const ready =
    motionOff() || (faded && visible.every((image) => decoded.current.has(image.filePath)))
  const visibleKey = visible.map((image) => image.id).join(',')

  /* The page is what arrives, so the run is set off by the page rather than by
     the list: a picture dragged into another slot, or one deleted, leaves the
     rest of the page exactly where it was and is not an arrival. */
  useEffect(() => {
    if (!ready) return
    setArriving(true)
    const id = window.setTimeout(() => setArriving(false), FLIP_TOTAL_MS)
    return () => window.clearTimeout(id)
  }, [ready, current, game.id])

  useEffect(() => {
    if (visible.every((image) => decoded.current.has(image.filePath))) return
    let cancelled = false
    void Promise.all(
      visible.map(async (image) => {
        // A clip has nothing to decode here: what the cell draws is its own
        // first frame, which the element fetches for itself.
        if (isVideoPath(image.filePath)) {
          decoded.current.add(image.filePath)
          return
        }
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

  /* **A cell is carried to where it is to stand.** The press is held rather
     than acted on — it could still be the click that opens the picture — and
     only once the pointer has moved a few pixels does the cell come off the
     grid and the page begin to reorder under it. Nothing is written until the
     release. */
  function pressCell(event: React.PointerEvent<HTMLElement>, imageId: number): void {
    // Only the left button carries a cell; the right one puts the menu up.
    if (event.button !== 0) return
    pressed.current = { id: imageId, x: event.clientX, y: event.clientY }
    dragged.current = false
    carriedId.current = imageId
    grab.current = null
  }

  /**
   * **Which slot of the grid the pointer is in**, worked out of the grid's own
   * geometry rather than by asking the cells where they are.
   *
   * Asking them is what made a swap shake: a displaced cell slides into its new
   * place over 0.15s, and while it is sliding its box sweeps *across* the
   * pointer — so a pointer standing still near a boundary was answered first by
   * one cell and then by the other, and the two swapped back and forth for as
   * long as it stood there. The slots do not move: five columns of 273 with 30
   * between them, rows of 154 with 20, from the grid's own top left.
   *
   * A pointer in a gap is in no slot at all, which is the answer to leave the
   * order alone.
   */
  function slotAt(clientX: number, clientY: number, nearest = false): number | null {
    const grid = document.querySelector<HTMLElement>('.thumb-grid')
    if (!grid) return null
    const box = grid.getBoundingClientRect()
    if (box.width <= 0) return null
    const scale = box.width / GRID_WIDTH
    const x = (clientX - box.left) / scale
    const y = (clientY - box.top) / scale

    let column = Math.floor(x / (CELL_WIDTH + COLUMN_GAP))
    let row = Math.floor(y / (CELL_HEIGHT + ROW_GAP))
    /* **`nearest` is for when the picture has to land somewhere.** A page
       turned under it is such a moment: the pointer is held against the edge of
       the board, which is *past* the last column and in no slot at all, and
       answering `null` there left the carried picture on the page it had come
       from — not drawn, and not where a release would put it either. Every
       point is in the grid then: outside is the row or column it is outside of,
       and a gap is the cell it began. */
    if (nearest) {
      column = Math.max(0, Math.min(COLUMNS - 1, column))
      row = Math.max(0, Math.min(ROWS - 1, row))
      return row * COLUMNS + column
    }
    if (column < 0 || column >= COLUMNS || row < 0 || row >= ROWS) return null
    if (x - column * (CELL_WIDTH + COLUMN_GAP) > CELL_WIDTH) return null
    if (y - row * (CELL_HEIGHT + ROW_GAP) > CELL_HEIGHT) return null
    return row * COLUMNS + column
  }

  /* **The picture is put under the point of it that was taken hold of.** The
     cell it belongs to keeps its slot and takes no transform, so its own box is
     that slot measured afresh — which is what makes this right whichever slot
     the cell is in. */
  const carriedCell = useCallback(
    (): HTMLElement | null =>
      carriedId.current === null
        ? null
        : document.querySelector<HTMLElement>(`[data-thumb-id="${carriedId.current}"]`),
    []
  )

  const placeCarried = useCallback((clientX: number, clientY: number): void => {
    const cell = carriedCell()
    const section = sectionRef.current?.getBoundingClientRect()
    if (!cell || !section || section.width <= 0) return
    const scale = section.width / BOARD_WIDTH
    const box = cell.getBoundingClientRect()
    const x = (clientX - box.left) / scale
    const y = (clientY - box.top) / scale
    if (!grab.current) grab.current = { x, y }
    cell.style.setProperty('--drag-x', `${x - grab.current.x}px`)
    cell.style.setProperty('--drag-y', `${y - grab.current.y}px`)
  }, [carriedCell])

  /* **A swap moves the cell, and the offset was worked out against where it
     used to be.** The order is settled in a render, so the frame that puts the
     cell in its new slot is a frame the pointer has not moved on — and the
     picture, still carrying the old slot's offset, jumped a whole cell and
     stayed there until the pointer moved again. It is placed again here, from
     where the pointer last was, before that frame is painted. */
  useLayoutEffect(() => {
    const at = pointerAt.current
    if (dragId !== null && at) placeCarried(at.x, at.y)
  }, [dragOrder, current, dragId, placeCarried])

  /* **The cells the carried one displaces slide into their new slots.** A
     reorder is a render, so without this they were simply somewhere else on the
     next frame — the picture being carried moved and the grid under it
     teleported. This is the ordinary first/last inversion: each cell is put
     back where it was standing, with no transition, and then let go of, and the
     0.15s the cell already carries on `transform` does the rest.
     
     What it is put back *to* is where it was standing **visually**, not where
     it was laid out — a cell caught still sliding from the swap before this one
     has a transform of its own part way through, and inverting to its layout
     position instead would snap it back to the start of a movement it was
     already half way through. */
  useLayoutEffect(() => {
    const home = cellHome.current
    if (!dragOrder) {
      home.clear()
      return
    }
    const next = new Map<number, { left: number; top: number }>()
    for (const cell of document.querySelectorAll<HTMLElement>('[data-thumb-id]')) {
      const id = Number(cell.dataset.thumbId)
      const left = cell.offsetLeft
      const top = cell.offsetTop
      next.set(id, { left, top })
      // The carried cell is the one thing not sliding: it is where it is.
      if (id === dragId) continue
      const was = home.get(id)
      if (!was) continue

      const drawn = getComputedStyle(cell).transform
      const shift = drawn === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(drawn)
      const dx = was.left + shift.e - left
      const dy = was.top + shift.f - top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue

      cell.style.transition = 'none'
      cell.style.transform = `translate(${dx}px, ${dy}px)`
      // Read something laid out, so the two writes are not collapsed into one.
      void cell.offsetWidth
      cell.style.transition = ''
      cell.style.transform = ''
    }
    cellHome.current = next
  }, [dragOrder, dragId])

  function moveCell(event: React.PointerEvent<HTMLElement>): void {
    const press = pressed.current
    if (!press) return

    if (dragId === null) {
      const far =
        Math.abs(event.clientX - press.x) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - press.y) > DRAG_THRESHOLD
      if (!far) return
      /* The pointer is captured only now, so a press that turns out to be a
         click is never taken off the button it landed on. */
      event.currentTarget.setPointerCapture(event.pointerId)
      dragged.current = true
      setDragId(press.id)
      setDragOrder(images.map((image) => image.id))
      return
    }

    if (!dragOrder) return

    pointerAt.current = { x: event.clientX, y: event.clientY }
    placeCarried(event.clientX, event.clientY)

    edgeHold(event.clientX, event.clientY)
    carryToPointer(event.clientX, event.clientY)
  }

  /** Stops whatever page turning the edge was doing. */
  function releaseEdge(): void {
    if (edge.current) {
      // The one id is a timeout while the hold is being counted out and an
      // interval afterwards; the two share a pool, so both are cleared.
      window.clearTimeout(edge.current.timer)
      window.clearInterval(edge.current.timer)
    }
    edge.current = null
  }

  /**
   * The pointer held against the left or right end of the grid turns the page,
   * and goes on turning it until it is moved off the edge or let go of.
   *
   * The turn is `turnedBack`'s own: a page reached backwards lands at its end,
   * the way the wheel leaves it, so a picture carried back arrives where it
   * would have carried on reading from.
   */
  function edgeHold(clientX: number, clientY: number): void {
    const grid = gridRef.current
    if (!grid) return releaseEdge()
    const box = grid.getBoundingClientRect()
    if (box.width <= 0) return releaseEdge()
    const band = EDGE_BAND * (box.width / BOARD_WIDTH)

    const inside = clientY >= box.top && clientY <= box.bottom
    const side: -1 | 1 | 0 = !inside
      ? 0
      : clientX <= box.left + band
        ? -1
        : clientX >= box.right - band
          ? 1
          : 0
    if (side === 0) return releaseEdge()
    // Already counting out this edge: leave it to finish rather than starting
    // the wait again on every move.
    if (edge.current?.side === side) return
    releaseEdge()

    const pages = Math.max(1, Math.ceil(images.length / PAGE_SIZE))
    const turn = (): void => {
      // A page reached backwards lands at its end, the way the wheel leaves it.
      turnedBack.current = side < 0
      setPage((was) => {
        const next = was + side
        return next < 1 || next > pages ? was : next
      })
    }
    /* The interval is put in the ref *before* the first turn, so a release
       fired from inside that turn has something to clear. */
    const timer = window.setTimeout(() => {
      const repeat = window.setInterval(turn, EDGE_REPEAT_MS)
      if (!edge.current) return window.clearInterval(repeat)
      edge.current.timer = repeat
      turn()
    }, EDGE_HOLD_MS)
    edge.current = { side, timer }
  }

  /* A page turned under a carried picture puts it on that page, in the slot the
     pointer is standing in — which is the edge it was held at, so it arrives
     where the pointer already is rather than at some end of the new page. */
  useLayoutEffect(() => {
    const at = pointerAt.current
    if (dragId !== null && at) carryToPointer(at.x, at.y, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  /** Puts the carried picture into whatever slot of the page the pointer is
      standing in, as an index into the whole list. */
  function carryToPointer(clientX: number, clientY: number, nearest = false): void {
    if (dragId === null || !dragOrder) return
    const slot = slotAt(clientX, clientY, nearest)
    if (slot === null) return
    /* A last page is not a full one, so a slot past its end is its end: what is
       being asked for is the place after everything, and there is no row there
       to be over. */
    const to = Math.min((current - 1) * PAGE_SIZE + slot, dragOrder.length - 1)
    const from = dragOrder.indexOf(dragId)
    if (from < 0 || to === from) return
    const next = [...dragOrder]
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    setDragOrder(next)
  }

  function releaseCell(): void {
    releaseEdge()
    const order = dragOrder
    const carried = dragId
    /* The picture goes back into its frame, which is now the frame in the slot
       it was carried to. */
    const cell = carriedCell()
    cell?.style.removeProperty('--drag-x')
    cell?.style.removeProperty('--drag-y')
    carriedId.current = null
    grab.current = null
    pointerAt.current = null
    pressed.current = null
    setDragId(null)
    setDragOrder(null)
    if (carried === null || !order) return

    const before = images.map((image) => image.id)
    if (order.every((id, index) => id === before[index])) return
    /* The order is the board's until APPLY writes it — see `apply`. */
    const byId = new Map(images.map((image) => [image.id, image]))
    setImages(order.map((id) => byId.get(id)).filter((image): image is GameImage => !!image))
  }

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

  /* The rows are written as they are added — the copies have to be under
     `userData` for `fvn-media:` to draw them — so what comes back is the whole
     gallery in the database's own order, with the pictures this board has staged
     for deletion still in it. Only the new ones are taken, onto the end of the
     board's own list, and their ids are kept so that CANCEL can take them out
     again. Shared by the picker and a drop, which differ only in where the
     files came from. */
  function absorbAdded(list: GameImage[], before: number): void {
    const known = new Set([...images, ...removed].map((image) => image.id))
    const fresh = list.filter((image) => !known.has(image.id))
    if (fresh.length === 0) return
    setAdded((ids) => [...ids, ...fresh.map((image) => image.id)])
    setImages((current) => [...current, ...fresh])
    // Land on the page the first newly added image went to, but leave the
    // selection — and so the applied thumbnail — where it was.
    setPage(Math.floor(before / PAGE_SIZE) + 1)
  }

  async function addImages(): Promise<void> {
    const before = images.length
    absorbAdded(await window.library.addGameImages(game.id), before)
  }

  /* **Files dropped from the file manager.** A dropped File carries no usable
     path across contextIsolation, so each is resolved through `webUtils` in the
     preload; the paths are narrowed to the gallery's own image and video kinds
     here (and again in the main process, which does the copy) so a stray file
     is simply left out rather than added and then undrawable. */
  async function addDropped(files: File[]): Promise<void> {
    const drawable = [...GALLERY_IMAGE_EXTENSIONS, ...GALLERY_VIDEO_EXTENSIONS]
    const paths = files
      .map((file) => window.library.pathForFile(file))
      .filter((one) => {
        const dot = one.lastIndexOf('.')
        return dot >= 0 && drawable.includes(one.slice(dot + 1).toLowerCase())
      })
    if (paths.length === 0) return
    const before = images.length
    absorbAdded(await window.library.addGameImagesFromPaths(game.id, paths), before)
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

  /* A deletion is staged rather than done: the file goes off disk with the
     row, and that is the one edit CANCEL could not take back. It leaves the
     board's list at once and is written by APPLY. */
  function confirmDelete(): void {
    if (!deleting) return
    const gone = deleting
    setRemoved((list) => [...list, gone])
    setImages((current) => current.filter((image) => image.id !== gone.id))
    if (selectedId === gone.id) setSelectedId(null)
    setDeleting(null)
    setViewing(null)
  }

  /* The menu's own 「メインサムネイルに設定」. It writes the thumbnail there and
     then rather than only marking the cell: APPLY is the design's button and
     still applies whatever is marked, but the row was asked to *set* it. The
     mark follows, so the ring on the grid still says which picture the game's
     Main Image is. */
  function makeThumbnail(image: GameImage): void {
    setSelectedId(image.id)
  }

  /* **Nothing the board does reaches the library until APPLY, and CANCEL
     leaves the library as the board found it.** The deletions are made, the
     order is written, the marked picture becomes the Main Image — in that
     order, so a picture staged for deletion is never the one applied. Whether
     there is anything to write is what the button answers to: a mark, an
     order changed, a picture added or one staged to go. */
  const dirty =
    removed.length > 0 ||
    added.length > 0 ||
    (selectedId !== null &&
      images.find((image) => image.id === selectedId)?.filePath !== game.thumbnailPath) ||
    images.length !== openedOrder.current.length ||
    images.some((image, index) => image.id !== openedOrder.current[index])
  async function apply(): Promise<void> {
    /* `committed` is set only once the writes have gone through, and after
       everything is written, so a write that throws leaves the board open with
       its edits intact rather than closing as though it had saved — and, since
       nothing was committed, the pictures added this session are still cleaned
       up if the board is then left another way. */
    try {
      for (const image of removed) await window.library.deleteGameImage(game.id, image.id)
      await window.library.reorderGameImages(
        game.id,
        images.map((image) => image.id)
      )
      const image = images.find((candidate) => candidate.id === selectedId)
      if (image) await window.library.setThumbnail(game.id, image.filePath)
      committed.current = true
      /* The picture to bring to the front of the Game board's carousel: the
         first one added this time, or — nothing added — the Main Image as it
         now stands (the mark just applied, or the thumbnail that was already
         there). */
      const firstAdded =
        added.length > 0 ? (images.find((one) => one.id === added[0])?.filePath ?? null) : null
      onApplied(firstAdded ?? image?.filePath ?? game.thumbnailPath ?? null)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('APPLY failed', error)
    }
  }

  /* **CANCEL puts the Main Image back to what it was when the board was
     opened.** 「メインサムネイルに設定」 writes the thumbnail there and then, so
     without this CANCEL was APPLY without the write — the board was left with
     whatever had been set from the menu, and the button did nothing that
     leaving by any other door did not. What it undoes is the thumbnail choice
     alone, that being what APPLY and CANCEL are about: a picture added,
     deleted or reordered is a change to the gallery rather than to the choice,
     and a deletion was asked about in its own right. A picture that was the
     Main Image on opening and has since been deleted cannot be put back, and
     the current choice stands. */
  async function cancel(): Promise<void> {
    committed.current = true
    await discardAdded()
    // Back to the picture the carousel was on when the board opened — the one
    // the gear was pressed over — falling back to the thumbnail.
    onCancel(openedFrom ?? game.thumbnailPath ?? null)
  }

  /* The pictures added this time are the one edit that had to be written on
     the way — and so the one thing CANCEL has to take back out. They go with
     their files, the way a deletion does. Called on CANCEL, and on the board
     being left by any other door while it has not been applied. */
  const discardAdded = useCallback(async (): Promise<void> => {
    const ids = addedRef.current
    if (ids.length === 0) return
    addedRef.current = []
    for (const id of ids) await window.library.deleteGameImage(gameIdRef.current, id)
    onGamesChangedRef.current()
  }, [])

  useEffect(
    () => () => {
      if (!committed.current) void discardAdded()
    },
    [discardAdded]
  )

  return (
    <section
      className={`add-thumbnail${dragOver ? ' is-drop' : ''}`}
      ref={sectionRef}
      /* A file drag from the file manager adds it, the way ADD IMAGE does.
         Gated on the drag carrying files so an internal image drag (which is
         pointer-driven anyway) never lights the hint. */
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={(event) => {
        // Only when the pointer leaves the board itself, not on the way across
        // its own children.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragOver(false)
        void addDropped(Array.from(event.dataTransfer.files))
      }}
    >
      {dragOver && (
        <div className="thumb-drop" aria-hidden="true">
          <span>{t('ここにドロップして画像・動画を追加')}</span>
        </div>
      )}
      {/* Penpot: Image Container — 1585x885, 35px top / 50px side padding */}
      <div className="thumb-container" ref={gridRef} onWheel={onWheel}>
        {!loaded ? null : images.length === 0 ? (
          <p className="thumb-empty">no images yet — use ADD IMAGE</p>
        ) : (
          <div
            className={`thumb-grid${ready ? ' is-ready' : ''}${
              arriving ? ' is-arriving' : ''
            }${dragId !== null ? ' is-dragging' : ''}`}
          >
            {visible.map((image, index) => (
              <div
                key={image.id}
                /* The cell stays up while its own menu is open. The plate is
                   drawn at the pointer, so the pointer is then on the plate
                   rather than on the cell and the hover it was raised by is
                   gone — it shrank back under the menu it had just put up. */
                className={`thumb-cell${selectedId === image.id ? ' selected' : ''}${
                  menu?.image.id === image.id ? ' is-open' : ''
                }${dragId === image.id ? ' is-carried' : ''}${image.r18 ? ' is-r18' : ''}`}
                /* What the drag hit-tests against: the pointer is over a cell
                   or it is over the gap between two, and the gap is no answer
                   at all. */
                data-thumb-id={image.id}
              >
                {/* **One click opens it full screen**, which is the one thing a
                    picture in a grid is looked at for. What used to be here —
                    a click that only moved a selection — said nothing on the
                    screen but a ring, and the ring now says something better:
                    which picture is the game's Main Image. Everything a cell
                    can be *made* to do is on the right press. */}
                <button
                  className="thumb-cell-image"
                  onPointerDown={(event) => pressCell(event, image.id)}
                  onPointerMove={moveCell}
                  onPointerUp={releaseCell}
                  onPointerCancel={releaseCell}
                  onClick={() => {
                    /* The release of a drag raises a click on the cell it set
                       off from. That press was carrying a picture, not opening
                       one. */
                    if (dragged.current) {
                      dragged.current = false
                      return
                    }
                    pressed.current = null
                    setViewing(images.findIndex((i) => i.id === image.id))
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    // The cell is what a second right-click on it toggles off.
                    menuOpener.current = event.currentTarget
                    const box = sectionRef.current?.getBoundingClientRect()
                    if (!box || box.width <= 0) return
                    /* The section is the board's own 1585 wide, which is what
                       recovers the shell's scale — the conversion every other
                       menu in the app makes against its own width. */
                    const scale = box.width / BOARD_WIDTH
                    /* The pointer in the board's own pixels; the plate is placed
                       against it once it has been measured (see the effect). */
                    setMenu({
                      image,
                      px: (event.clientX - box.left) / scale,
                      py: (event.clientY - box.top) / scale
                    })
                  }}
                  aria-pressed={selectedId === image.id}
                >
                  {/* Flips in along the grid's anti-diagonals: top-left first,
                      then the pair below/right of it, and so on.

                      **A clip runs in its own cell**, silently and on a loop:
                      a page of a gallery is looked at to find something in it,
                      and a still frame of a clip is often the one part of it
                      that says nothing. It playing is also what says it is a
                      clip, so nothing is drawn over it to say so. The sound is
                      the full-screen viewer's, where one clip is the only
                      thing on the screen. */}
                  {isVideoPath(image.filePath) ? (
                    <video
                      src={mediaUrl(image.filePath)}
                      /* **Chromium drags a picture out of a page by itself.**
                         That native drag takes the pointer with it — the
                         capture is broken and a `pointercancel` arrives — so
                         the cell was let go of on the first pixel it moved and
                         nothing was ever reordered. */
                      draggable={false}
                      muted
                      autoPlay
                      loop
                      playsInline
                      preload="auto"
                      style={{
                        animationDelay: `${
                          (Math.floor(index / COLUMNS) + (index % COLUMNS)) * FLIP_STAGGER
                        }ms`
                      }}
                    />
                  ) : (
                    <img
                      src={mediaUrl(image.filePath)}
                      alt=""
                      // See the clip above: the browser's own drag is what was
                      // cancelling this one.
                      draggable={false}
                      decoding="async"
                      style={{
                        animationDelay: `${
                          (Math.floor(index / COLUMNS) + (index % COLUMNS)) * FLIP_STAGGER
                        }ms`
                      }}
                    />
                  )}
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
            onClick={() => void apply()}
            disabled={!dirty}
            title={!dirty ? t('変更はありません') : undefined}
          >
            APPLY
          </button>
          <button className="thumb-button cancel" onClick={() => void cancel()}>
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

      {menu && (
        <ContextMenu
          /* Placed at the pointer and hidden until the effect has measured the
             plate and set where it really goes, so it never flashes at the
             wrong spot. */
          style={{
            top: `${menuXY?.y ?? menu.py}px`,
            left: `${menuXY?.x ?? menu.px}px`,
            visibility: menuXY ? 'visible' : 'hidden'
          }}
          items={[
            /* **A clip cannot be the game's Main Image.** What a thumbnail is
               read by — the side panel's row, the Home board's cards and
               spines, the Add Game dialog's own slot — draws a picture and
               nothing else, so the row is simply not offered on a clip rather
               than offered and then breaking those. It is also the only way a
               cell is marked, which is what keeps APPLY honest: what is
               selected can only ever be a picture. */
            ...(isVideoPath(menu.image.filePath)
              ? []
              : [
                  {
                    label: t('メインサムネイルに設定'),
                    onSelect: (): void => {
                      makeThumbnail(menu.image)
                      setMenu(null)
                    }
                  }
                ]),
            {
              /* R18 is a mark on the picture and nothing else: the frame goes
                 red for it, and the Extra Function board's green circle draws
                 from the pictures so marked. The row reads as the act it would
                 do, so a marked picture's row offers the unmarking. */
              label: menu.image.r18 ? t('R18を解除する') : t('R18に設定する'),
              onSelect: () => {
                /* Written at once — it is a mark on the picture rather than
                   an edit to the gallery — but the list that comes back is
                   the database's, with this board's staged edits not in it,
                   so only the mark is taken from it. */
                const marked = !menu.image.r18
                void window.library.setGameImageR18(game.id, menu.image.id, marked).then(() =>
                  setImages((current) =>
                    current.map((image) => (image.id === menu.image.id ? { ...image, r18: marked } : image))
                  )
                )
                setMenu(null)
              }
            },
            {
              label: t('ファイルの場所を開く'),
              onSelect: () => {
                /* The picture the row means is the file it was added *from* —
                   the one the player has, where they keep it. What the gallery
                   draws is the app's own copy, under `userData` with a UUID
                   for a name, and it stands in only once the original is gone
                   from disk. */
                void window.library.showItemInFolder(
                  menu.image.sourcePath ?? menu.image.filePath,
                  menu.image.filePath
                )
                setMenu(null)
              }
            },
            {
              label: t('削除'),
              danger: true,
              onSelect: () => {
                setDeleting(menu.image)
                setMenu(null)
              }
            }
          ]}
        />
      )}

      {viewing !== null && images.length > 0 && (
        <div
          className="image-viewer"
          onWheel={onViewerWheel}
          onClick={(e) => {
            // Anywhere but the picture itself and the controls closes it.
            const target = e.target as HTMLElement
            if (
              target.tagName !== 'IMG' &&
              target.tagName !== 'VIDEO' &&
              !target.closest('button')
            ) {
              setViewing(null)
            }
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
                  {/* Opened, a clip is the one thing on the screen and is
                      played as one: the platform's own controls, and it starts
                      by itself — it was opened to be watched. Only the middle
                      slot does; the two beside it are the neighbours waiting
                      offstage. */}
                  {isVideoPath(image.filePath) ? (
                    <video
                      src={mediaUrl(image.filePath)}
                      controls={offset === 0}
                      autoPlay={offset === 0}
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img src={mediaUrl(image.filePath)} alt="" />
                  )}
                </div>
              )
            })}
          </div>

          <button
            className="viewer-arrow prev"
            onClick={() => stepViewer(-1)}
            disabled={images.length <= 1}
            aria-label={t('前の画像')}
          >
            <svg viewBox="0 0 43.29 86.58">
              <path d="M43.29,0 L43.29,86.58 L0,43.29 Z" fill="#B1B2B5" />
            </svg>
          </button>

          <button
            className="viewer-arrow next"
            onClick={() => stepViewer(1)}
            disabled={images.length <= 1}
            aria-label={t('次の画像')}
          >
            <svg viewBox="0 0 43.29 86.58">
              <path d="M0,0 L0,86.58 L43.29,43.29 Z" fill="#B1B2B5" />
            </svg>
          </button>

          <button
            className="viewer-back"
            onClick={() => setViewing(null)}
            title={t('一覧に戻る')}
            aria-label={t('一覧に戻る')}
          >
            <i className="fa-solid fa-angles-left" />
          </button>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="delete image"
          message={t('この画像を削除しますか？')}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  )
}
