import { useEffect, useRef, useState } from 'react'
import type { NewGroupInput } from '../../../shared/db-types'
import { clamp01, hexToHsv, hsvToHex, HEX, SWATCHES } from '../color'
import './NewGroupSetting.css'

/** The design draws Red Selected, so red is the colour a new group opens on. */
const DEFAULT_COLOR = '#e01f1f'

interface Props {
  onCancel: () => void
  onSubmit: (input: NewGroupInput) => void
}

/**
 * Penpot board "New Group Setting" (8dc20177-e0ad-80ef-8008-7eb9835f9faf),
 * 416x479 — a name and a colour under the same "Color Setting" board the Add
 * Route Menu carries, over the design's CANCEL / OK pair.
 */
export default function NewGroupSetting({ onCancel, onSubmit }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)

  // The picker's own hue. Black and the greys have no hue of their own, so it
  // is held here rather than read back out of the colour every time — dragging
  // to the bottom of the square and back must come up the same hue.
  const [hue, setHue] = useState(0)
  // What the picker itself last wrote. Reading the hue back out of its own
  // output and rounding it would walk the hue a degree at a time across a drag,
  // so the sync below ignores the colours it produced.
  const pickerColor = useRef<string | null>(null)

  // A colour that arrived from the code field or a swatch moves the picker.
  useEffect(() => {
    if (pickerColor.current === color) return
    const hsv = hexToHsv(color)
    if (hsv && hsv.s > 0 && hsv.v > 0) setHue(Math.round(hsv.h))
  }, [color])

  const hsv = hexToHsv(color)
  const saturation = hsv ? hsv.s : 0
  const brightness = hsv ? hsv.v : 0

  function setPickedColor(next: string): void {
    pickerColor.current = next
    setColor(next)
  }

  /** The square: saturation across it, brightness up it. */
  function pickInSquare(event: React.PointerEvent<HTMLDivElement>): void {
    const box = event.currentTarget.getBoundingClientRect()
    setPickedColor(
      hsvToHex(
        hue,
        clamp01((event.clientX - box.left) / box.width),
        1 - clamp01((event.clientY - box.top) / box.height)
      )
    )
  }

  /** The strip above it: the pure hue the square is cut from. */
  function pickHue(next: number): void {
    setHue(next)
    setPickedColor(hsvToHex(next, saturation, brightness))
  }

  function submit(): void {
    if (!name.trim()) return
    onSubmit({ name: name.trim(), color: HEX.test(color) ? color : DEFAULT_COLOR })
  }

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="new-group" onClick={(e) => e.stopPropagation()}>
        {/* Penpot: "New Group" — Girassol 36px, #e1e8ed */}
        <span className="ng-title">New Group</span>

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
                aria-label="グループ名"
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
                    aria-label="カラーコード"
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
              {/* Penpot draws a 130x132 plate here. It is the picker: a hue
                  strip over the square that cuts saturation and brightness out
                  of the hue it names. */}
              <div className="ng-picker">
                <input
                  type="range"
                  className="ng-hue"
                  min={0}
                  max={359}
                  value={hue}
                  onChange={(e) => pickHue(Number(e.target.value))}
                  aria-label="色相"
                />
                <div
                  className="ng-sv"
                  style={{ backgroundColor: hsvToHex(hue, 1, 1) }}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    pickInSquare(e)
                  }}
                  onPointerMove={(e) => {
                    if (e.buttons & 1) pickInSquare(e)
                  }}
                >
                  <span
                    className="ng-sv-marker"
                    style={{
                      left: `${saturation * 100}%`,
                      top: `${(1 - brightness) * 100}%`
                    }}
                  />
                </div>
              </div>
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
