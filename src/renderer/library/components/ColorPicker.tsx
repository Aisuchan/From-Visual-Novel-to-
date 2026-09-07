import { useEffect, useRef, useState } from 'react'
import { clamp01, hexToHsv, hsvToHex } from '../color'
import './ColorPicker.css'
import { t } from '../../../shared/i18n'

interface Props {
  /** #rrggbb. A colour from anywhere else — a code field, a swatch — moves the
      picker to it. */
  color: string
  onChange: (color: string) => void
  /** The caller's own class, which is where the box's size comes from: Penpot
      draws it 130x132 on New Group Setting and 118x118 on the Plan board. */
  className: string
}

/**
 * A hue strip over the square that cuts saturation and brightness out of the
 * hue it names. Penpot draws a plain plate wherever this goes; the picker is
 * the app's own, and is shared so the hue bookkeeping below is written once.
 */
export default function ColorPicker({ color, onChange, className }: Props): React.JSX.Element {
  /* The picker's own hue. Black and the greys have no hue of their own, so it
     is held here rather than read back out of the colour every time — dragging
     to the bottom of the square and back must come up the same hue. */
  const [hue, setHue] = useState(0)
  /* What the picker itself last wrote. Reading the hue back out of its own
     output and rounding it would walk the hue a degree at a time across a drag,
     so the sync below ignores the colours it produced. */
  const pickerColor = useRef<string | null>(null)

  useEffect(() => {
    if (pickerColor.current === color) return
    const hsv = hexToHsv(color)
    if (hsv && hsv.s > 0 && hsv.v > 0) setHue(Math.round(hsv.h))
  }, [color])

  const hsv = hexToHsv(color)
  const saturation = hsv ? hsv.s : 0
  const brightness = hsv ? hsv.v : 0

  function write(next: string): void {
    pickerColor.current = next
    onChange(next)
  }

  /** The square: saturation across it, brightness up it. */
  function pickInSquare(event: React.PointerEvent<HTMLDivElement>): void {
    const box = event.currentTarget.getBoundingClientRect()
    write(
      hsvToHex(
        hue,
        clamp01((event.clientX - box.left) / box.width),
        1 - clamp01((event.clientY - box.top) / box.height)
      )
    )
  }

  return (
    <div className={`color-picker ${className}`}>
      <input
        type="range"
        className="color-picker-hue"
        min={0}
        max={359}
        value={hue}
        onChange={(event) => {
          const next = Number(event.target.value)
          setHue(next)
          write(hsvToHex(next, saturation, brightness))
        }}
        aria-label={t('色相')}
      />
      <div
        className="color-picker-square"
        style={{ backgroundColor: hsvToHex(hue, 1, 1) }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pickInSquare(event)
        }}
        onPointerMove={(event) => {
          if (event.buttons & 1) pickInSquare(event)
        }}
      >
        <span
          className="color-picker-marker"
          style={{ left: `${saturation * 100}%`, top: `${(1 - brightness) * 100}%` }}
        />
      </div>
    </div>
  )
}
