import type { GameWithStats } from '../../../shared/db-types'
import './GameInfo.css'

interface Props {
  game: GameWithStats
  /**
   * Anchor the board on the mark at its other end. A long title pushes the
   * board's right edge past the content column, and Penpot already draws a
   * second mark at the far end of the Top Icon row: reversing the row puts the
   * circle-info there instead, so the board swings left of the title without
   * the mark under the pointer moving at all.
   */
  flipped: boolean
}

/**
 * Penpot board "Game Info" (5a9514e2-b188-8034-8008-798e00b359e8), 446x480.
 *
 * The design's top-left "◯" is the same mark the title carries, so it is drawn
 * as the same Font Awesome circle-info glyph in the same 50x60 box; GameDetail
 * hangs the panel off that mark so the two land on each other exactly.
 *
 * BRAND / RELEASE DATE / AVERAGE / MEDIAN come from the deferred
 * ErogeScape/VNDB import, so they read "--" until that exists.
 */
export default function GameInfo({ game, flipped }: Props): React.JSX.Element {
  void game

  return (
    <div className={`game-info ${flipped ? 'flipped' : ''}`} role="tooltip">
      {/* Penpot: Top Icon — 426x70, 5px padding, space-between */}
      <div className="gi-top-icon">
        <span className="gi-mark">
          <i className="fa-solid fa-circle-info" />
        </span>
        <span className="gi-rule" />
        <span className="gi-rating">🔞</span>
      </div>

      {/* Penpot: Content — Left Border / Show / Right Border */}
      <div className="gi-content">
        <div className="gi-border">
          <span className="gi-border-rule" />
        </div>

        <div className="gi-show">
          <div className="gi-field">
            <span className="gi-caption">BRAND</span>
            <span className="gi-value">--</span>
          </div>

          <div className="gi-field">
            <span className="gi-caption">RELEASE DATE</span>
            <span className="gi-value">--</span>
          </div>

          {/* Penpot: Average and Median — row, 70px gap */}
          <div className="gi-scores">
            <div className="gi-field">
              <span className="gi-caption">AVERAGE</span>
              <span className="gi-value">--</span>
            </div>
            <div className="gi-field">
              <span className="gi-caption">MEDIAN</span>
              <span className="gi-value">--</span>
            </div>
          </div>
        </div>

        <div className="gi-border">
          <span className="gi-border-rule" />
        </div>
      </div>

      {/* Penpot: Bottom — two 87x63 corner wedges either side of a 242x2 rule */}
      <div className="gi-bottom">
        <svg className="gi-wedge" viewBox="0 0 87 63" preserveAspectRatio="none">
          <path d="M87,63 L0,0 L0,63 Z" fill="#2a2d31" />
        </svg>
        <span className="gi-bottom-rule" />
        <svg className="gi-wedge" viewBox="0 0 87 63" preserveAspectRatio="none">
          <path d="M0,63 L87,0 L87,63 Z" fill="#2a2d31" />
        </svg>
      </div>
    </div>
  )
}
