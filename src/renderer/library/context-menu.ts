import { useEffect, useRef, type MutableRefObject } from 'react'

/** How long after the press its own `contextmenu` can still be expected. */
const GESTURE_MS = 1000

/**
 * What every right-click menu in the app does while it is up: any press outside
 * the plate, or Escape, puts it away.
 *
 * **A second right-click on the same thing is a dismissal and nothing else.**
 * The press that closes the plate is the same press that would raise the next
 * one, so left alone a menu did not go away — it moved to wherever the pointer
 * now was, and there was no putting it away by right-clicking. The
 * `contextmenu` that press is about to raise is therefore swallowed in the
 * capture phase, before anything in the page can act on it.
 *
 * **On anything else that press is let through**, which is what makes a menu
 * moveable between things that have one: right-click a second game row and the
 * first row's plate goes and the second's arrives, in the one gesture, because
 * the dismissal below runs on the press and the opener runs on the
 * `contextmenu` after it. On something with no menu of its own, only the
 * dismissal happens, so the plate goes and nothing takes its place. Swallowing
 * every second right-click alike meant a menu could only ever be dismissed and
 * then opened again, two gestures for what reads as one.
 *
 * Two presses toggle rather than move: one back on the element the plate was
 * opened on, which is why this returns a ref — an opener puts the row, the
 * cell or the triangle it was fired from into it — and one on the plate
 * itself, since nothing can be right-clicked *through* an open menu. The
 * second of those is the ordinary case rather than the corner one: the plate
 * is drawn at the pointer, so right-clicking the same spot again lands on the
 * plate and not on what is under it.
 *
 * **The swallowing listener outlives this hook's own effect on purpose.** The
 * press dismisses the menu, which tears the effect down on the very next
 * render — before the `contextmenu` arrives — so removing it in the cleanup
 * swallowed nothing at all and the menu simply moved. It is `once` instead,
 * and it holds the time of its own press: a gesture that somehow never raised
 * a menu leaves it to expire rather than to eat a later one.
 *
 * The side panel's rows, the Game board's Progress triangle and the Home
 * board's cells all share this, which is what keeps the three menus behaving
 * alike.
 */
export function useContextMenuDismiss(
  open: boolean,
  close: () => void
): MutableRefObject<HTMLElement | null> {
  /* Held in a ref so the listeners are put up once per opening rather than on
     every render: a caller writes the closer inline. */
  const dismiss = useRef(close)
  dismiss.current = close

  /** The element this plate was opened on; see above. */
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onMouseDown = (event: MouseEvent): void => {
      /* 2 is the right button. Its `contextmenu` is eaten only when the press
         landed back on what opened this plate — that is the toggle. Anywhere
         else it is left alone, so whatever is under the pointer can open its
         own menu on the same gesture, or nothing can. */
      const target = event.target as HTMLElement
      /* The press toggles this plate off — rather than opening whatever is
         under the pointer — when it lands back on what opened it, or on the
         plate itself. **The plate is the common case, not the corner one**: it
         is drawn at the pointer, so right-clicking the same spot a second time
         lands on the plate and not on the thing underneath. That press
         dismisses the plate, and Chromium then works out where its
         `contextmenu` goes from what is under the cursor *after* the handlers
         have run — by which time the plate is gone and the cell is back — so
         the menu was raised again where it had just been taken away, exactly
         as if it had never closed. */
      const toggling =
        opener.current?.contains(target) === true || target.closest?.('.context-menu') != null
      if (event.button === 2 && toggling) {
        const pressedAt = event.timeStamp
        const swallowOnce = (next: Event): void => {
          if (next.timeStamp - pressedAt > GESTURE_MS) return
          next.preventDefault()
          next.stopPropagation()
        }
        window.addEventListener('contextmenu', swallowOnce, { capture: true, once: true })
      }
      dismiss.current()
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss.current()
    }

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
      // Closed: what it was opened on is no longer anything to compare against.
      opener.current = null
    }
  }, [open])

  return opener
}
