/**
 * What a route's slice of the play time is written as, and what colour it is
 * written in. The Route board's ring and the ROUTE frame's bar draw the same
 * figures, so they read the same here rather than each keeping their own.
 */

/** "38%", "25.2%" — the reference's own way with the odd figures. */
export function formatShare(share: number): string {
  const percent = share * 100
  return `${percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10}%`
}

/** The ink a share is written in, set on its own route's colour rather than on
    the board: the board's own dark against a light route, the app's text
    against a dark one. */
export function shareInk(color: string): string {
  const hex = color.replace('#', '')
  if (hex.length !== 6) return 'var(--color-text)'
  const channel = (at: number): number => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  return luminance > 0.25 ? 'var(--color-bg)' : 'var(--color-text)'
}
