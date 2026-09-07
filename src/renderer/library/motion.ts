/*
 * The Setting board's アニメーション row, read where a movement is timed
 * rather than passed down through every board that has one.
 *
 * The shell writes the setting onto the document as `data-animations`, which
 * is also what the stylesheet's own kill switch is keyed on (see App.css), so
 * the two halves of the answer — the rules and the clocks — cannot disagree.
 * The rules cover everything a `@keyframes` or a `transition` does; what is
 * left is the handful of movements the app runs itself, on a timer or a
 * `requestAnimationFrame` loop, and those read this.
 *
 * It is read at the moment a movement is set off rather than held in state:
 * nothing is mid-flight when the row is changed, the Setting board being the
 * board that is up while it is.
 */
export function motionOff(): boolean {
  return document.documentElement.dataset.animations === 'off'
}

/** A duration or a delay, taken to nothing while the row is off. */
export function motionMs(ms: number): number {
  return motionOff() ? 0 : ms
}
