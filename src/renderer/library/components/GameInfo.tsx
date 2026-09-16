import { useEffect, useRef, useState } from 'react'
import type { GameReference, GameWithStats, VndbReleaseLanguage } from '../../../shared/db-types'
import { formatFullDate } from '../format'
import { maskOf } from '../mask'
import { referenceUrl } from '../reference'
import eroScaMark from '../../assets/EroSca.png'
import vndbMark from '../../assets/VNDB.png'
import { getLanguage, t } from '../../../shared/i18n'
import './GameInfo.css'

/** ISO YYYY-MM-DD → the shape the language writes a whole date in, which is
    what the release date is edited in so the field matches its own view — the
    English board reads 06/09/2026, so it is typed that way too rather than in
    the stored ISO. */
function releaseDateToDisplay(iso: string): string {
  return iso ? formatFullDate(new Date(`${iso}T00:00:00`)) : ''
}

/** The reverse: the localized run back to a stored YYYY-MM-DD, or null where it
    is not a date the calendar can hold (an impossible day included). */
function displayToReleaseDate(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const en = getLanguage() === 'en'
  const parts = en
    ? trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) // MM/DD/YYYY
    : trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) // YYYY-MM-DD
  if (!parts) return null
  const [y, m, d] = en ? [parts[3], parts[1], parts[2]] : [parts[1], parts[2], parts[3]]
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  const date = new Date(`${iso}T00:00:00`)
  return date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d)
    ? iso
    : null
}

/* The BRAND value's box. The design draws it at 40 in a 261-wide field and cut
   a longer brand with an ellipsis; instead the run is stepped down to fit —
   measured at the base size and scaled by the ratio it overruns by, the way the
   Sort field's `FitLabel` and the clock's date are, down to a floor so it never
   disappears. The field is given 360 rather than 261: the value grows past the
   fixed-width `.gi-show` into the empty room up to the side rules, so the rules
   do not move (see the sheet). BRAND_MAX must match that width. */
const BRAND_MAX = 360
const BRAND_BASE = 40
const BRAND_MIN = 16

function FitValue({ text }: { text: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = (): void => {
      el.style.fontSize = `${BRAND_BASE}px`
      const measured = el.scrollWidth
      const size =
        measured > BRAND_MAX
          ? Math.max(BRAND_MIN, Math.floor(BRAND_BASE * (BRAND_MAX / measured)))
          : BRAND_BASE
      el.style.fontSize = `${size}px`
    }
    fit()
    // The face may still be a fallback when this first runs; re-fit once Girassol
    // has loaded, the way `FitLabel` does.
    void document.fonts.ready.then(fit)
  }, [text])
  return (
    <span className="gi-value fit" ref={ref} title={text}>
      {text}
    </span>
  )
}

/* What the mark beside the release date says, which is not the code the
   setting stores: the board writes jp / en / ch, which is how a reader names
   the three. It is a mark rather than a run with another language in it — the
   letters are the same in both — so it does not go through `t`. */
const RELEASE_LANGUAGE_MARK: Record<VndbReleaseLanguage, string> = {
  ja: 'jp',
  en: 'en',
  zh: 'ch'
}

interface Props {
  game: GameWithStats
  /** Whether the board is being typed into. It is held by the caller because
      the panel is a hover: while this is on, the mark it hangs off must not put
      it away when the pointer moves onto the board and off again. */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** Writes the four values the board draws. */
  onSave: (input: GameReference) => void
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
 * **BRAND / RELEASE DATE / AVERAGE / MEDIAN are what the Add Game dialog's
 * Reference row read off ErogameScape**, and a row the game has nothing for
 * reads "--" — which is every game registered by hand, and every field a page
 * did not carry.
 *
 * **And the design's 🔞 is the board's one control.** Penpot draws it inert;
 * which control it is depends on what the game has. With a page registered it
 * opens that page in the system's own browser — the figures are a summary, and
 * what is behind them is the page itself. **With none it is a gear**, and the
 * gear turns the board over into itself: the four values become the fields they
 * were read into. A board that says "--" four times ought to say what to do
 * about it, and what to do about it is to write them.
 *
 * **The values are typed where they are read**, in the same boxes at the same
 * places, so nothing on the board moves when the gear is pressed — and the pair
 * that commits or gives up stands in the Bottom, which is the one band the
 * design leaves empty.
 */
export default function GameInfo({
  game,
  flipped,
  editing,
  onEditingChange,
  onSave
}: Props): React.JSX.Element {
  const url = game.referenceUrl
  /* **The mark says which database the button opens**, rather than standing for
     the rating the design's own 🔞 does: the app reads two sites and the page
     behind this button is on one of them, so the site's own mark is what tells
     a reader where the press goes. Which one is read off the address itself
     (`referenceUrl`, the same function the Add Game row decides with), not off
     the interface's language — the language a library is kept in says nothing
     about where a particular game was looked up. A URL neither site answers to
     keeps the design's emoji. */
  const site = url ? (referenceUrl(url)?.site ?? null) : null
  /** A figure the page did not carry is written the way the design's own
      placeholder is, rather than as a blank. */
  const value = (text: string | number | null): string =>
    text === null || text === '' ? '--' : String(text)

  /* **What is being typed, kept apart from the game.** The board is opened on
     what the game has and CANCEL simply drops it, so nothing is written until
     OK — the same rule the Add Game dialog follows. */
  const [draft, setDraft] = useState(() => ({
    brand: game.brand ?? '',
    releaseDate: releaseDateToDisplay(game.releaseDate ?? ''),
    medianScore: game.medianScore === null ? '' : String(game.medianScore),
    averageScore: game.averageScore === null ? '' : String(game.averageScore)
  }))

  function open(): void {
    setDraft({
      brand: game.brand ?? '',
      releaseDate: releaseDateToDisplay(game.releaseDate ?? ''),
      medianScore: game.medianScore === null ? '' : String(game.medianScore),
      averageScore: game.averageScore === null ? '' : String(game.averageScore)
    })
    onEditingChange(true)
  }

  /** A figure typed as anything but one is no figure, which is a value taken
      away rather than a zero put in its place. */
  const figure = (text: string): number | null => {
    const trimmed = text.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  function commit(): void {
    onSave({
      brand: draft.brand.trim() || null,
      /* Typed in the language's own date shape and stored back as the ISO the
         column is sorted on; anything that is not a date is left out. */
      releaseDate: displayToReleaseDate(draft.releaseDate),
      medianScore: figure(draft.medianScore),
      averageScore: figure(draft.averageScore)
    })
    onEditingChange(false)
  }

  return (
    <div className={`game-info ${flipped ? 'flipped' : ''}`} role="tooltip">
      {/* Penpot: Top Icon — 426x70, 5px padding, space-between */}
      <div className="gi-top-icon">
        <span className="gi-mark">
          <i className="fa-solid fa-circle-info" />
        </span>
        <span className="gi-rule" />
        {url && !editing ? (
          <button
            type="button"
            className="gi-rating"
            onClick={() => void window.library.openExternal(url)}
            title={t('登録したページを開く')}
          >
            {site ? (
              <span className="gi-site-mark" style={maskOf(site === 'vndb' ? vndbMark : eroScaMark)} />
            ) : (
              '🔞'
            )}
          </button>
        ) : (
          <button
            type="button"
            className="gi-rating gear"
            onClick={() => (editing ? onEditingChange(false) : open())}
            title={t('情報を設定')}
          >
            <i className="fa-solid fa-gear" />
          </button>
        )}
      </div>

      {/* Penpot: Content — Left Border / Show / Right Border */}
      <div className="gi-content">
        <div className="gi-border">
          <span className="gi-border-rule" />
        </div>

        <div className="gi-show">
          <div className="gi-field">
            <span className="gi-caption">BRAND</span>
            {editing ? (
              <input
                className="gi-value gi-input"
                value={draft.brand}
                autoFocus
                onChange={(event) => setDraft({ ...draft, brand: event.target.value })}
              />
            ) : (
              <FitValue text={value(game.brand)} />
            )}
          </div>

          <div className="gi-field">
            <span className="gi-caption">RELEASE DATE</span>
            {editing ? (
              /* Typed in the language's own date shape so the field matches the
                 view above it — MM/DD/YYYY under ENG, YYYY-MM-DD in Japanese —
                 and stored back as ISO on OK. */
              <input
                className="gi-value gi-input"
                value={draft.releaseDate}
                placeholder={getLanguage() === 'en' ? 'MM/DD/YYYY' : 'YYYY-MM-DD'}
                onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })}
              />
            ) : (
              /* Written the way the language writes a whole date, as the Play
                 log's are: the parts change places between the two. */
              <span className="gi-value">
                {game.releaseDate ? formatFullDate(new Date(`${game.releaseDate}T00:00:00`)) : '--'}
              </span>
            )}
            {/* **Which release this date is, where the date came off a page
                that lists one per language.** The VN Database gives a game a
                date per market and the Setting board's row says which is
                preferred, with the Japanese one standing in where that one was
                never released — so the date alone does not say what it is a
                date *of*, and this is what says it. A date typed by hand or
                read off ErogameScape carries none, so nothing is drawn.

                **It stands under the date rather than beside it**, and out of
                the flow: the board is a fixed 480 and clips, so a field that
                grew by a line would push the two score rows out of the bottom
                of it. The 30 between one field and the next is the room it
                hangs in. */}
            {!editing && game.releaseDate && game.releaseLanguage && (
              <span className="gi-release-language">
                ({RELEASE_LANGUAGE_MARK[game.releaseLanguage]})
              </span>
            )}
          </div>

          {/* Penpot: Average and Median — row, 70px gap */}
          <div className="gi-scores">
            <div className="gi-field">
              <span className="gi-caption">AVERAGE</span>
              {editing ? (
                <input
                  className="gi-value gi-input narrow"
                  value={draft.averageScore}
                  inputMode="decimal"
                  onChange={(event) => setDraft({ ...draft, averageScore: event.target.value })}
                />
              ) : (
                <span className="gi-value">{value(game.averageScore)}</span>
              )}
            </div>
            <div className="gi-field">
              <span className="gi-caption">MEDIAN</span>
              {editing ? (
                <input
                  className="gi-value gi-input narrow"
                  value={draft.medianScore}
                  inputMode="decimal"
                  onChange={(event) => setDraft({ ...draft, medianScore: event.target.value })}
                />
              ) : (
                <span className="gi-value">{value(game.medianScore)}</span>
              )}
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
        {/* **The pair stands where the rule does**, which is the one band the
            design leaves empty — so nothing on the board moves for it and the
            two corner wedges are still the board's own corners. */}
        {editing ? (
          <div className="gi-actions">
            <button type="button" className="gi-ok" onClick={commit}>
              OK
            </button>
            <button type="button" className="gi-cancel" onClick={() => onEditingChange(false)}>
              CANCEL
            </button>
          </div>
        ) : (
          <span className="gi-bottom-rule" />
        )}
        <svg className="gi-wedge" viewBox="0 0 87 63" preserveAspectRatio="none">
          <path d="M0,63 L87,0 L87,63 Z" fill="#2a2d31" />
        </svg>
      </div>
    </div>
  )
}
