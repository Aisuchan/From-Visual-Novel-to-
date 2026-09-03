import type { GameWithStats } from '../../../shared/db-types'
import { formatLastPlayed, formatPlaytimeSeconds } from '../format'
import './GameHover.css'

interface Props {
  game: GameWithStats
}

export default function GameHover({ game }: Props): React.JSX.Element {
  return (
    <div className="game-hover">
      <div className="game-hover-row name">
        <span className="game-hover-label">NAME:</span>
        <span className="game-hover-value">{game.title}</span>
      </div>
      <div className="game-hover-row name">
        <span className="game-hover-label">SHORTNAME:</span>
        <span className="game-hover-value">{game.shortName || '-'}</span>
      </div>
      <div className="game-hover-row">
        <span className="game-hover-label">PLAYTIME:</span>
        {/* Penpot writes "999h" here; the row carries the minutes and the
            seconds too, a play time being read off this panel rather than
            glanced at the way the footer's totals are. */}
        <span className="game-hover-value">
          {formatPlaytimeSeconds(game.stats.totalPlaySeconds)}
        </span>
      </div>
      <div className="game-hover-row">
        <span className="game-hover-label">LAST PLAYED:</span>
        <span className="game-hover-value">
          {formatLastPlayed(game.stats.lastPlayedAt).text}
        </span>
      </div>
      <div className="game-hover-row">
        <span className="game-hover-label">GROUP:</span>
        <span className="game-hover-value">{game.groupName || '-'}</span>
      </div>
    </div>
  )
}
