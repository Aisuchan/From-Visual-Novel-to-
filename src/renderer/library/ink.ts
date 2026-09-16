/**
 * **Putting a run's ink on the middle of its box, which the box does not do.**
 *
 * What a flex container centres is the line box, and a line box is centred on
 * the font's ascent and descent rather than on what is drawn in it. In this
 * app's faces that is never the same place: a lowercase Girassol run is small
 * caps standing on the baseline with the descender's room empty under it, a
 * figure or a capital reaches higher, and a Japanese glyph — which comes off
 * the fallback face on the primary's baseline — higher still. Measured at the
 * Setting board's 41: a kanji 3.0px over the middle, "png" 3.5 under it. No
 * one constant serves a box that writes all of them, so a run is measured as
 * it is drawn and moved by what it comes to.
 *
 * **Two measurements, and neither is worked out from the font's metrics.**
 * Where the baseline stands is read off the DOM — an empty inline-block sits on
 * the baseline of the line it is in, so its bottom edge *is* it — because
 * Blink places it with integer arithmetic of its own (the half-leading is
 * floored) and a baseline computed from `fontBoundingBoxAscent` came out
 * 0.85px from the real one, which left every run a pixel short of centred.
 * How far the ink reaches either side of that baseline is `measureText`'s,
 * which a pixel scan of the same run agrees with to the pixel. The rects are
 * in the shell's zoomed pixels and the canvas in unzoomed ones, so the extent
 * is scaled by the zoom before the two are compared and the shift scaled back
 * before it is written.
 */

/* One canvas for every measurement: it is a ruler, not a drawing. */
let ruler: CanvasRenderingContext2D | null = null

/** How far a run's ink reaches above and below the baseline, in CSS px at
    `size`, in the app's display face. */
export function inkExtent(text: string, size: number): { above: number; below: number } {
  ruler ??= document.createElement('canvas').getContext('2d')
  if (!ruler) return { above: 0, below: 0 }
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-display')
  ruler.font = `${size}px ${family}`
  const m = ruler.measureText(text)
  return {
    above: m.actualBoundingBoxAscent,
    below: m.actualBoundingBoxDescent
  }
}

/**
 * The `translateY` that puts `text`'s ink on the middle of `el`'s box —
 * positive to move it down — given the empty inline-block `probe` standing on
 * the run's baseline inside `el`. `el`'s box must be the line box: a flex
 * item, or a block, whose height is its line height. Zero where the box has
 * no height yet.
 */
export function inkShift(el: HTMLElement, probe: HTMLElement, text: string, size: number): number {
  const box = el.getBoundingClientRect()
  if (box.height === 0 || el.offsetHeight === 0) return 0
  const zoom = box.height / el.offsetHeight
  const baseline = probe.getBoundingClientRect().bottom
  const { above, below } = inkExtent(text, size)
  const boxMiddle = (box.top + box.bottom) / 2
  const inkMiddle = baseline - ((above - below) / 2) * zoom
  return (boxMiddle - inkMiddle) / zoom
}

/** Writes `inkShift`'s answer onto `el`, or clears it where the answer is
    under a quarter of a pixel — a transform for nothing is a layer for
    nothing. */
export function centreInk(el: HTMLElement, probe: HTMLElement, text: string, size: number): void {
  el.style.transform = ''
  const shift = inkShift(el, probe, text, size)
  if (Math.abs(shift) >= 0.25) el.style.transform = `translateY(${shift.toFixed(2)}px)`
}
