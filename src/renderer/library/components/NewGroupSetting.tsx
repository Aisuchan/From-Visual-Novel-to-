import { useState } from 'react'
import type { Group, NewGroupInput } from '../../../shared/db-types'
import { HEX, SWATCHES } from '../color'
import ColorPicker from './ColorPicker'
import './NewGroupSetting.css'
import { t } from '../../../shared/i18n'

/** The design draws Red Selected, so red is the colour a new group opens on. */
const DEFAULT_COLOR = '#e01f1f'

interface Props {
  onCancel: () => void
  onSubmit: (input: NewGroupInput) => void
  /* The group this board was opened *on*, where it was opened by a right press
     on one in the list rather than by 「グループを追加」. The same board either
     way — a group is a name and a colour whether it is being made or changed —
     so what it opens with is all that differs, and its heading. */
  group?: Group
}

/**
 * Penpot board "New Group Setting" (8dc20177-e0ad-80ef-8008-7eb9835f9faf),
 * 416x479 — a name and a colour under the same "Color Setting" board the Add
 * Route Menu carries, over the design's CANCEL / OK pair.
 */
export default function NewGroupSetting({
  onCancel,
  onSubmit,
  group
}: Props): React.JSX.Element {
  const [name, setName] = useState(group?.name ?? '')
  const [color, setColor] = useState(group?.color ?? DEFAULT_COLOR)

  function submit(): void {
    if (!name.trim()) return
    onSubmit({ name: name.trim(), color: HEX.test(color) ? color : DEFAULT_COLOR })
  }

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="new-group" onClick={(e) => e.stopPropagation()}>
        {/* Penpot: "New Group" — Girassol 36px, #e1e8ed */}
        <span className="ng-title">{group ? t('グループを編集') : 'New Group'}</span>

        {/* Penpot: Rectangle — 356x2 #B1B2B5, 5px above and below */}
        <div className="ng-rule" />

        {/* Penpot: Setting — the two fields, 5px apart */}
        <div className="ng-setting">
          {/* Penpot: Group Name — 356x108 */}
          <div className="ng-field">
            <span className="ng-label">Group Name</span>
            <div className="ng-input">
              <input
                value={name}
                placeholder="Name..."
                maxLength={40}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                aria-label={t('グループ名')}
              />
            </div>
          </div>

          {/* Penpot: Color — 356x196 */}
          <div className="ng-field">
            <span className="ng-label">Color</span>
            {/* Penpot: Color Setting — 356x132, 15px between the two */}
            <div className="ng-color-setting">
              {/* Penpot: Color Option — 211x132, the code field over the swatches */}
              <div className="ng-color-option">
                <div className="ng-input">
                  <input
                    value={color}
                    placeholder="Color Code..."
                    maxLength={7}
                    spellCheck={false}
                    onChange={(e) =>
                      setColor(e.target.value.replace(/[^#0-9a-fA-F]/g, '').slice(0, 7))
                    }
                    aria-label={t('カラーコード')}
                  />
                  {/* The colour itself, read off the end of the field it is
                      written in. */}
                  <span
                    className="ng-color-dot"
                    style={{ background: HEX.test(color) ? color : 'transparent' }}
                  />
                </div>
                {/* Penpot: Template Color — 211x78, 5 across by 2 down */}
                <div className="ng-swatches">
                  {SWATCHES.map((swatch) => (
                    <button
                      type="button"
                      key={swatch}
                      className={`ng-swatch ${
                        swatch.toLowerCase() === color.toLowerCase() ? 'selected' : ''
                      }`}
                      style={{ background: swatch }}
                      onClick={() => setColor(swatch)}
                      aria-label={swatch}
                    />
                  ))}
                </div>
              </div>
              {/* Penpot draws a 130x132 plate here. It is the picker. */}
              <ColorPicker className="ng-picker" color={color} onChange={setColor} />
            </div>
          </div>
        </div>

        <div className="ng-rule" />

        {/* Penpot: Add Route Menu Buttons — 356x52, the pair 30px apart */}
        <div className="ng-buttons">
          <button type="button" className="ng-button cancel" onClick={onCancel}>
            <span>CANCEL</span>
          </button>
          <button type="button" className="ng-button" disabled={!name.trim()} onClick={submit}>
            <span>OK</span>
          </button>
        </div>
      </div>
    </div>
  )
}
