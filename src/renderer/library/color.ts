/* The colour a route or a group carries, and the maths the pickers that set it
   need. Penpot draws the same "Color" board in Add Route Menu and in New Group
   Setting, so both read their palette and their conversions from here. */

/* Penpot: Template Color — a 5x2 grid read row by row. Named in the design
   Red Selected / Blue / Green / Yellow / Pink, then Orange / Skyblue /
   Dark Green / Dark Yellow / Purple. */
export const SWATCHES = [
  '#e01f1f',
  '#1e46e0',
  '#10b40b',
  '#d5c912',
  '#dc1dd6',
  '#f45c14',
  '#13c5f4',
  '#2d8e0f',
  '#a07329',
  '#9734e5'
]

export const HEX = /^#[0-9a-f]{6}$/i

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** h in degrees, s and v in 0..1, out as #rrggbb. */
export function hsvToHex(h: number, s: number, v: number): string {
  const channel = (n: number): string => {
    const k = (n + h / 60) % 6
    const x = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(x * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`
}

/** The inverse, for a colour that arrived from the code field or a swatch. */
export function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  if (!HEX.test(hex)) return null
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const span = max - Math.min(r, g, b)
  let h = 0
  if (span !== 0) {
    if (max === r) h = ((g - b) / span) % 6
    else if (max === g) h = (b - r) / span + 2
    else h = (r - g) / span + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s: max === 0 ? 0 : span / max, v: max }
}
