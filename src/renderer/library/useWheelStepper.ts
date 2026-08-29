import { useRef } from 'react'

/** One notch of a mouse wheel: Chromium reports 100-120px for one of those. */
export const WHEEL_NOTCH = 100

/**
 * Turns wheel deltas into whole steps, one per notch, for the carousels the
 * wheel drives (the Middle row and the Add Thumbnail viewer).
 *
 * Deltas are accumulated rather than rate-limited, so spinning fast steps as
 * fast as the wheel is turned while a trackpad's small deltas still have to add
 * up to a notch's worth first; a change of direction restarts the count rather
 * than cancelling out against what came before.
 */
export function useWheelStepper(
  step: (direction: 1 | -1) => void
): (event: React.WheelEvent) => void {
  const accumulated = useRef(0)

  return (event: React.WheelEvent): void => {
    if (event.deltaY === 0) return
    // Normalise the line and page delta modes to pixels.
    const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1
    const delta = event.deltaY * scale
    const total = accumulated.current * delta > 0 ? accumulated.current + delta : delta

    const steps = Math.trunc(total / WHEEL_NOTCH)
    if (steps === 0) {
      accumulated.current = total
      return
    }
    accumulated.current = 0

    const direction = steps > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(steps); i++) step(direction)
  }
}
