import type { GameWithStats } from '../../../shared/db-types'
import { formatHours, formatLastPlayed } from '../format'
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
        <span className="game-hover-value">{formatHours(game.stats.totalPlaySeconds)}</span>
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
