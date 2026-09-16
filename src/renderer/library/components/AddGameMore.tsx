import type { Language } from '../../../shared/db-types'
import './AddGameMore.css'

interface Props {
  language: Language
  brand: string
  releaseDate: string
  purchaseDate: string
  purchasePrice: string
  listPrice: string
  onBrand: (value: string) => void
  onReleaseDate: (value: string) => void
  onPurchaseDate: (value: string) => void
  onPurchasePrice: (value: string) => void
  onListPrice: (value: string) => void
}

/**
 * Penpot board "Add Game More" (1c7a6731-6a56-809d-8008-a17cfa799604), 435x490
 * — the advanced panel the Setting board's 「Add Gameに高度な設定を追加」 row
 * puts to the left of the Add Game dialog. Under a 10px inner stroke, each a
 * Girassol 24 name over a 39-tall field: Brand Name, Release Date, Purchase
 * Date, and Purchase Price — with List Price added at the foot, which the
 * design does not draw but which lets 定価 be recorded and exported.
 *
 * **Brand Name and Release Date are filled from the Reference row** — pressing
 * 参照 on the dialog reads them off ErogameScape or the VN Database into these
 * fields — and both stay editable. **Release Date and Purchase Date are date
 * inputs** (`type="date"`, which is the YYYY-MM-DD the release date is stored
 * as). **Purchase Price shows the app's currency**: ¥ in Japanese, ＄ under
 * ENG, the design's own ¥ read the way `t` is.
 */
export default function AddGameMore({
  language,
  brand,
  releaseDate,
  purchaseDate,
  purchasePrice,
  listPrice,
  onBrand,
  onReleaseDate,
  onPurchaseDate,
  onPurchasePrice,
  onListPrice
}: Props): React.JSX.Element {
  return (
    <div className="add-game-more" onClick={(event) => event.stopPropagation()}>
      {/* Penpot: Brand — the name over a 363x39 input, "Name..." its
          placeholder */}
      <div className="agm-row">
        <label className="agm-label" htmlFor="agm-brand">
          Brand Name
        </label>
        <input
          id="agm-brand"
          className="agm-input"
          value={brand}
          onChange={(event) => onBrand(event.target.value)}
          placeholder="Name..."
        />
      </div>
      <div className="agm-rule" />

      {/* Penpot: Release Date — the name over the input, a date field here */}
      <div className="agm-row">
        <label className="agm-label" htmlFor="agm-release">
          Release Date
        </label>
        <input
          id="agm-release"
          className="agm-input agm-date"
          type="date"
          value={releaseDate}
          onChange={(event) => onReleaseDate(event.target.value)}
        />
      </div>
      <div className="agm-rule" />

      {/* Penpot: Purchase Date — the same, a date field */}
      <div className="agm-row">
        <label className="agm-label" htmlFor="agm-purchase-date">
          Purchase Date
        </label>
        <input
          id="agm-purchase-date"
          className="agm-input agm-date"
          type="date"
          value={purchaseDate}
          onChange={(event) => onPurchaseDate(event.target.value)}
        />
      </div>
      <div className="agm-rule" />

      {/* Penpot: Purchase Price — the name over a 44-tall input carrying the
          currency mark at Girassol 28 and "Price..." past it */}
      <div className="agm-row price">
        <label className="agm-label" htmlFor="agm-price">
          Purchase Price
        </label>
        <div className="agm-price-box">
          <span className="agm-currency">{language === 'en' ? '$' : '¥'}</span>
          <input
            id="agm-price"
            className="agm-price-input"
            type="number"
            min="0"
            step="1"
            value={purchasePrice}
            onChange={(event) => onPurchasePrice(event.target.value)}
            placeholder="Price..."
          />
        </div>
      </div>
      <div className="agm-rule" />

      {/* List Price — the design does not draw it; it is the same field as
          Purchase Price, added at the foot so 定価 can be recorded and exported. */}
      <div className="agm-row price">
        <label className="agm-label" htmlFor="agm-list-price">
          List Price
        </label>
        <div className="agm-price-box">
          <span className="agm-currency">{language === 'en' ? '$' : '¥'}</span>
          <input
            id="agm-list-price"
            className="agm-price-input"
            type="number"
            min="0"
            step="1"
            value={listPrice}
            onChange={(event) => onListPrice(event.target.value)}
            placeholder="Price..."
          />
        </div>
      </div>
    </div>
  )
}
