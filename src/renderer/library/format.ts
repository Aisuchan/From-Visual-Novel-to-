export function formatHours(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  return `${hours}h`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatClock(date: Date): { dateLabel: string; timeLabel: string } {
  const dateLabel = `${date.getFullYear()} ${date.getMonth() + 1}/${date.getDate()} (${
    WEEKDAY_LABELS[date.getDay()]
  }.)`
  const pad = (n: number): string => String(n).padStart(2, '0')
  const timeLabel = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return { dateLabel, timeLabel }
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
