import { useEffect } from 'react'

/**
 * The Penpot design is authored on a fixed 1920x1080 canvas. To reproduce it
 * exactly at any window size, the whole shell is laid out in design pixels and
 * uniformly scaled by `zoom` so that 1920 design px always spans the window
 * width. Height is left to flex: the extra rows a taller-than-16:9 window gives
 * us go to the parts of the design that are meant to stretch (game list, main
 * image area).
 */
export const DESIGN_WIDTH = 1920

export function useUiScale(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    function apply(): void {
      const el = ref.current
      if (!el) return
      const scale = window.innerWidth / DESIGN_WIDTH
      el.style.zoom = String(scale)
      el.style.width = `${DESIGN_WIDTH}px`
      el.style.height = `${window.innerHeight / scale}px`
    }

    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [ref])
}
