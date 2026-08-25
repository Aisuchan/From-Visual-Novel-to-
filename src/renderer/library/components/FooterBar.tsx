import type { FooterStats } from '../../../shared/db-types'
import { formatHours } from '../format'
import './FooterBar.css'

interface Props {
  stats: FooterStats | null
}

export default function FooterBar({ stats }: Props): React.JSX.Element {
  return (
    <footer className="footer-bar">
      <span>Today {formatHours(stats?.todaySeconds ?? 0)}</span>
      <span>/ Week {formatHours(stats?.weekSeconds ?? 0)}</span>
      <span>/ Month {formatHours(stats?.monthSeconds ?? 0)}</span>
    </footer>
  )
}
