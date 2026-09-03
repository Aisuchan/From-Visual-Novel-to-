import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../../shared/db-types'
import { GEAR_PATH, GEAR_VIEW_BOX } from '../gear'
import OptionMenu from './OptionMenu'
import './Setting.css'

/** Penpot: Setting — the board's own width, which the menu's scale comes off. */
const BOARD_WIDTH = 1585
/** Penpot: Select Box — 207 wide, which the menu under it takes too. */
const SELECT_WIDTH = 207
/** Penpot: "enable" — 41px in a 167 box with 25px of padding either side. */
const SELECT_FONT_SIZE = 41
const SELECT_LABEL_WIDTH = 167 - 25 * 2

/** Every setting there is happens to be one of a fixed list, so every row on
    the board is the design's Select Box: the field says which value is on and
    the menu is the only way to change it, the way the side panel's Sort field
    works. Nothing is typed into any of them. */
type SelectKey = keyof AppSettings

interface SelectRow {
  key: SelectKey
  /** Penpot: "Setting Name". None of these rows carries a description — the
      design writes one under every name, and these need none — so the name
      stands alone in the middle of its row. */
  name: string
  title: string
  options: { key: string; label: string }[]
}

/* The rows in the order they are drawn. The language row is stored and read
   back and nothing else reads it yet; the three format rows each name the file
   one of the Recorder Panel's buttons writes, and are read where that file is
   made (`capture.ts`). */
const SELECT_ROWS: SelectRow[] = [
  {
    key: 'language',
    name: '言語/language',
    title: '言語を選ぶ',
    options: [
      { key: 'ja', label: '日本語' },
      { key: 'en', label: 'ENG' }
    ]
  },
  {
    key: 'screenshotFormat',
    name: 'スクリーンショットの形式',
    title: 'スクリーンショットの形式を選ぶ',
    options: [
      { key: 'png', label: 'png' },
      { key: 'jpg', label: 'jpg' }
    ]
  },
  {
    key: 'videoFormat',
    name: '画面録画ファイルの形式',
    title: '画面録画ファイルの形式を選ぶ',
    options: [
      { key: 'mp4', label: 'mp4' },
      { key: 'mov', label: 'mov' }
    ]
  },
  {
    key: 'audioFormat',
    name: '録音ファイルの形式',
    title: '録音ファイルの形式を選ぶ',
    options: [
      { key: 'mp3', label: 'mp3' },
      { key: 'wav', label: 'wav' }
    ]
  }
]

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

export default function Setting({ settings, onChange }: Props): React.JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null)
  /* Whichever row's Select Box the menu is hanging off. One ref rather than one
     per row: only one menu is ever up, and this is what tells `OptionMenu` to
     leave the button that opened it alone when it dismisses on a click. */
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  /* Where the menu hangs, in the board's own design pixels. It is measured when
     the row is opened rather than written down as a constant: the rows scroll
     once there are more of them than the container is tall. `position: fixed`
     and `getBoundingClientRect` do not share the shell's coordinate space, so
     the rect is converted by the board's own known width — the same conversion
     the side panel makes against its 335. */
  const [menu, setMenu] = useState<{ key: SelectKey; top: number; left: number } | null>(null)

  function toggleMenu(key: SelectKey, button: HTMLButtonElement): void {
    const board = boardRef.current
    if (!board) return
    if (menu?.key === key) {
      setMenu(null)
      return
    }
    const boardRect = board.getBoundingClientRect()
    const rect = button.getBoundingClientRect()
    const scale = boardRect.width / BOARD_WIDTH
    anchorRef.current = button
    setMenu({
      key,
      top: (rect.bottom - boardRect.top) / scale,
      left: (rect.left - boardRect.left) / scale
    })
  }

  const openRow = SELECT_ROWS.find((row) => row.key === menu?.key)

  return (
    <div className="setting-board" ref={boardRef}>
      {/* Penpot: Top — 1515x84 */}
      <div className="setting-top">
        <div className="setting-heading">
          {/* Penpot: Letter — the "⚙" mark and the word, 10px apart */}
          <div className="setting-letter">
            <span className="setting-mark">
              <svg viewBox={GEAR_VIEW_BOX} aria-hidden="true">
                <path d={GEAR_PATH} />
              </svg>
            </span>
            <h1 className="setting-word">Setting</h1>
          </div>

          {/* Penpot: Under Line — a 351px bar plus a 132x8 tapering triangle */}
          <div className="setting-underline">
            <span className="setting-underline-bar" />
            <svg className="setting-underline-tail" viewBox="0 0 132 8" preserveAspectRatio="none">
              <path d="M0,0 L132,0 L0,8 Z" fill="#e1e8ed" />
            </svg>
          </div>
        </div>
      </div>

      {/* Penpot: Setting Container — 1585x811, 1px #657786 */}
      <div className="setting-container">
        {/* Penpot: Setting Column — 1585x141, with the design's Select Box on
            it. Four of them come to 564 of the container's 811, so the list
            still stands whole; past that the container is what scrolls. */}
        {SELECT_ROWS.map((row) => {
          const value =
            row.options.find((option) => option.key === settings[row.key]) ?? row.options[0]
          return (
            <div className="setting-column" key={row.key}>
              <div className="setting-explain">
                <span className="setting-name">{row.name}</span>
              </div>

              {/* Penpot: Select Box — 207x59. The whole box is the button
                  rather than only the arrow, there being nothing to type. */}
              <button
                className="setting-select"
                onClick={(event) => toggleMenu(row.key, event.currentTarget)}
                title={row.title}
                aria-haspopup="menu"
                aria-expanded={menu?.key === row.key}
              >
                <span className="setting-select-value">
                  <SelectLabel label={value.label} />
                </span>
                <span className="setting-select-arrow">
                  <span className="setting-select-caret">▼</span>
                </span>
              </button>
            </div>
          )
        })}

        {/* Penpot draws a row with an On / Off Button on it and it is a
            placeholder: a "Setting Name" over a "Setting description...". It
            is ported as drawn and left inert, the way the other deferred
            features' controls are — the shape is here for a real setting to be
            dropped into. */}
        <div className="setting-column">
          <div className="setting-explain">
            <span className="setting-name">Setting Name</span>
            <span className="setting-description">Setting description...</span>
          </div>

          {/* Penpot: On / Off Button — 207x59 */}
          <div className="setting-switch" title="未実装">
            <div className="setting-switch-half on chosen">
              <span className="setting-switch-label">on</span>
            </div>
            <div className="setting-switch-half off">
              <span className="setting-switch-label">off</span>
            </div>
          </div>
        </div>
      </div>

      {menu && openRow && (
        <OptionMenu
          options={openRow.options}
          top={menu.top}
          left={menu.left}
          width={SELECT_WIDTH}
          maxRows={openRow.options.length}
          onPick={(key) => {
            onChange({ [openRow.key]: key } as Partial<AppSettings>)
            setMenu(null)
          }}
          onDismiss={() => setMenu(null)}
          anchorRef={anchorRef}
        />
      )}
    </div>
  )
}

/* Penpot sets the value at 41px, and "enable" comes to exactly the 117 the box
   leaves for it. A language's name is whatever it is called in its own
   language, so the label steps down just far enough to fit the way the clock's
   date and the menu's own rows do. */
function SelectLabel({ label }: { label: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.fontSize = `${SELECT_FONT_SIZE}px`
    const width = el.scrollWidth
    if (width > SELECT_LABEL_WIDTH) {
      el.style.fontSize = `${Math.floor(SELECT_FONT_SIZE * (SELECT_LABEL_WIDTH / width))}px`
    }
  }, [label])

  return (
    <span className="setting-select-label" ref={ref}>
      {label}
    </span>
  )
}
