import type { CSSProperties } from 'react'

/**
 * A picture drawn as a **shape** rather than as its own pixels, so it takes the
 * colour of whatever it stands in.
 *
 * The two site marks (`assets/EroSca.png`, `assets/VNDB.png`) are single-colour
 * silhouettes on transparency — measured, every opaque pixel of both is
 * #657786, which is the app's own `--color-text-dim` — so what carries their
 * meaning is the alpha and not the colour. Used as a mask, the element paints
 * `currentColor` through that alpha: the mark then takes the ink of the row it
 * is in and follows it through a hover, exactly as the Font Awesome glyphs
 * beside it do. An `<img>` cannot do that — it draws the colour it was saved
 * with — and a `filter` chain that tried to push one colour to another is a
 * calculation nobody can read.
 *
 * The URL is a bundler's (`import mark from './x.png'` answers with the emitted
 * address), so it cannot be written in a stylesheet: the size, the position and
 * the `currentColor` fill live in CSS and only the file comes from here.
 */
export function maskOf(url: string): CSSProperties {
  const value = `url(${JSON.stringify(url)}) center / contain no-repeat`
  // WebkitMaskImage is still what Chromium takes for the shorthand's own
  // longhand set; both are written so the rule holds whichever it reads.
  return { maskImage: `url(${JSON.stringify(url)})`, WebkitMask: value, mask: value }
}
