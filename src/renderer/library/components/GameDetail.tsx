import type { GameWithStats } from '../../../shared/db-types'
import { formatDate, formatHours } from '../format'
import PlayButtonExtend from './PlayButtonExtend'
import './GameDetail.css'

interface Props {
  game: GameWithStats
  isPlaying: boolean
  onLaunch: (opts: { recordTime: boolean; useRecorderPanel: boolean; runAsAdmin: boolean }) => void
  onPrev: () => void
  onNext: () => void
}

export default function GameDetail({ game, isPlaying, onLaunch, onPrev, onNext }: Props): React.JSX.Element {
  return (
    <section className="game-detail">
      <header className="game-detail-header">
        <h1 className="game-title">{game.title}</h1>
        <span className="title-underline" />
      </header>

      <div className="game-banner-row">
        <button className="nav-arrow" onClick={onPrev} aria-label="前のゲーム">
          ◀
        </button>
        <div className="game-banner">
          {game.thumbnailPath ? (
            <img src={`file://${game.thumbnailPath}`} alt={game.title} />
          ) : (
            <div className="game-banner-placeholder" />
          )}
        </div>
        <button className="nav-arrow" onClick={onNext} aria-label="次のゲーム">
          ▶
        </button>
      </div>

      <div className="game-detail-footer">
        <PlayButtonExtend gameId={game.id} onLaunch={onLaunch} disabled={isPlaying} />

        <div className="stat">
          <span className="stat-label">TOTAL PLAY</span>
          <span className="stat-value">{formatHours(game.stats.totalPlaySeconds)}</span>
        </div>

        <div className="stat">
          <span className="stat-label">LAST PLAYED</span>
          <span className="stat-value">{formatDate(game.stats.lastPlayedAt)}</span>
        </div>

        {isPlaying && <div className="playing-badge">プレイ中…</div>}
      </div>
    </section>
  )
}
