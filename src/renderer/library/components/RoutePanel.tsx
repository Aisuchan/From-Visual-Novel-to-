import { useEffect, useRef, useState } from 'react'
import type { Route } from '../../../shared/db-types'
import { formatPlaytime, splitPlaytime } from '../format'
import { clamp01, hexToHsv, hsvToHex, HEX, SWATCHES } from '../color'
import ConfirmDialog from './ConfirmDialog'
import PieChart from './PieChart'
import './RoutePanel.css'

interface Props {
  /** The game the routes belong to; changing it starts the list over. */
  gameId: number
  /** Design-px x of the panel's left edge inside "Under". */
  left: number
  /** Design-px y of its bottom edge, measured from "Under"'s bottom. */
  bottom: number
  open: boolean
  /** Marks a route cleared with the same celebration a cleared game gets. */
  onCelebrate: () => void
  /** Reports the game's routes back out, so the ROUTE frame can graph them.
      The board owns the list because it is the only thing that edits it, but
      it is kept mounted, so it reads the list whether or not it is out. The
      game they belong to comes with them: the frame outlives a switch between
      games, and must not draw the last one's routes over the next one. */
  onRoutes: (gameId: number, routes: Route[]) => void
}

/** Which face of Penpot's "Route Maneger" is out. */
type View = 'default' | 'manage'
/** Which of the "Tab Name" tabs is selected inside the manage face. */
type Tab = 'add' | 'change'

/** A blank Add form. The design draws Red Selected, so red is offered first. */
const BLANK_FORM = {
  name: '',
  color: '#e01f1f',
  hours: '0',
  minutes: '0',
  cleared: false
}

/** Digits only, `max` of them, no leading zeros, never past `cap`. */
function digitsOnly(raw: string, max: number, cap?: number): string {
  const digits = raw
    .replace(/\D/g, '')
    .slice(0, max)
    .replace(/^0+(?=\d)/, '')
  if (cap !== undefined && digits !== '' && Number(digits) > cap) return String(cap)
  return digits
}

/* The chart is a ring rather than a full disc: the design's Circle carries a
   label in the middle, and a wedge of a route's own colour under it would take
   the label with it. Once a route has time on it the plate itself goes and only
   the ring is left, so the middle is the board showing through.

   Its geometry, its arrival, its sweep and the ink its shares take are all
   `PieChart`'s: the PlayTime Graph board draws the same chart at 750, so every
   figure is written once, against this board's own 350. */

/** Penpot: Hover Pie Route — 260x118 */
const HOVER_W = 260
const HOVER_H = 118

/** Penpot writes a route's time "999:99" — hours, then padded minutes. */
function formatRouteTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

/** What the two fields hold, back as the seconds the route keeps. */
function formSeconds(form: { hours: string; minutes: string }): number {
  return (Number(form.hours) || 0) * 3600 + (Number(form.minutes) || 0) * 60
}

/**
 * Penpot board "Route" (0fa3147b-f76a-80c2-8008-7acfd8885584) — 416x612, shown
 * over the ROUTE frame while it is open. It has the two faces the design
 * carries, and MANEGE ROUTE turns it from one to the other:
 *
 * - `default` — Pie Chart over Active Route, with the MANEGE ROUTE button.
 * - `manage` — Add Route Menu (the ADD / CHANGE tabs and whichever of the two
 *   forms they select) over the CANCEL / OK buttons. This is the state the
 *   design file itself is left in.
 *
 * The routes themselves live in the `routes` table; every call into it comes
 * back with the game's whole list, so this holds nothing but what the database
 * last said. The pie chart over their play time is still deferred.
 */
export default function RoutePanel({
  gameId,
  left,
  bottom,
  open,
  onCelebrate,
  onRoutes
}: Props): React.JSX.Element {
  const [view, setView] = useState<View>('default')
  const [tab, setTab] = useState<Tab>('add')
  const [routes, setRoutes] = useState<Route[]>([])
  const [form, setForm] = useState(BLANK_FORM)
  const [deleting, setDeleting] = useState<Route | null>(null)
  /** The pie segment under the pointer, and where in the board to sit the
      Hover Pie Route board over it. */
  /* Bumped every time the board opens, and keys the chart, so the sweep and
     the pop run again on a panel that was only hidden rather than unmounted. */
  const [reveal, setReveal] = useState(0)
  const [hovered, setHovered] = useState<{
    route: Route
    x: number
    y: number
  } | null>(null)
  const pieRef = useRef<HTMLDivElement | null>(null)
  // The route a Change column was clicked on, which puts the Add form up as an
  // editor over it.
  const [editing, setEditing] = useState<Route | null>(null)
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
    if (pickerColor.current === form.color) return
    const hsv = hexToHsv(form.color)
    if (hsv && hsv.s > 0 && hsv.v > 0) setHue(Math.round(hsv.h))
  }, [form.color])

  // Routes belong to a game, so the list is read back whenever the side panel
  // moves to another one — and again when a session ends, since the main
  // process has just banked its time on whichever route was active.
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.library.listRoutes(gameId).then((list) => {
        if (!cancelled) setRoutes(list)
      })
    }
    load()
    setEditing(null)
    const unsubscribe = window.library.onSessionEnded((payload) => {
      if (payload.gameId === gameId) load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [gameId])

  useEffect(() => {
    onRoutes(gameId, routes)
  }, [gameId, routes, onRoutes])

  // The board always comes back on its default face with a blank form.
  // Resetting as it opens rather than as it closes keeps the fade-out showing
  // what was on it.
  useEffect(() => {
    if (!open) return
    setView('default')
    setTab('add')
    setForm(BLANK_FORM)
    setDeleting(null)
    setEditing(null)
    setHovered(null)
    setReveal((n) => n + 1)
  }, [open])

  const activeIndex = routes.findIndex((route) => route.isActive)
  const active = activeIndex === -1 ? null : routes[activeIndex]

  const hsv = hexToHsv(form.color)
  const saturation = hsv ? hsv.s : 0
  const brightness = hsv ? hsv.v : 0

  /* One wedge per route that has time on it, in list order from twelve
     o'clock, each carrying its own colour. A route still on 00:00 has nothing
     to draw. The wedge geometry itself is `PieChart`'s. */
  const timed = routes.filter((route) => route.playSeconds > 0)
  const totalSeconds = timed.reduce((sum, route) => sum + route.playSeconds, 0)
  const slices = timed.map((route) => ({
    key: String(route.id),
    color: route.color,
    share: route.playSeconds / totalSeconds
  }))

  /** `.rp-pie` is 416 design px wide, which is what recovers the shell's own
      scale — see the note on `designTopWithin` in SidePanel. */
  function trackPointer(event: React.MouseEvent, route: Route): void {
    const box = pieRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0) return
    const scale = box.width / 416
    const x = (event.clientX - box.left) / scale
    const y = (event.clientY - box.top) / scale

    // Below and to the right of the pointer, wherever that puts it. The board
    // clips its own children, so the hover board is drawn beside it rather than
    // in it -- see the render.
    setHovered({ route, x: x + 14, y: y + 14 })
  }

  function setPickedColor(color: string): void {
    pickerColor.current = color
    setForm((prev) => ({ ...prev, color }))
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

  /* The stepper walks one slot past the list: the end of it is "記録しない",
     which is no route being active at all. Only the Active Route field offers
     it — the Change list is the routes themselves. */
  const OFF_SLOT = routes.length

  function step(by: number): void {
    if (routes.length === 0) return
    const slots = routes.length + 1
    const from = activeIndex === -1 ? OFF_SLOT : activeIndex
    const next = (from + by + slots) % slots
    void window.library
      .setActiveRoute(gameId, next === OFF_SLOT ? null : routes[next].id)
      .then(setRoutes)
  }

  /** Switching tabs always leaves whatever was being edited or typed. */
  function selectTab(next: Tab): void {
    setTab(next)
    setEditing(null)
    setForm(BLANK_FORM)
  }

  /** A Change column puts its route into the form. */
  function openEdit(route: Route): void {
    setEditing(route)
    const split = splitPlaytime(route.playSeconds)
    setForm({
      name: route.name,
      color: route.color,
      hours: String(split.hours),
      minutes: String(split.minutes),
      cleared: route.cleared
    })
  }

  /** OK on the editor: write it back, go home, and celebrate a cleared one. */
  function commitEdit(): void {
    if (!editing) return
    const name = form.name.trim()
    if (name === '') return
    // Only the crossing is worth celebrating: a route that was already cleared
    // and is saved again has not just been finished.
    const justCleared = form.cleared && !editing.cleared
    void window.library
      .updateRoute(gameId, editing.id, {
        name,
        color: form.color,
        playSeconds: formSeconds(form),
        cleared: form.cleared
      })
      .then(setRoutes)
    // OK leaves the editor for the list it was opened from, not the board.
    setEditing(null)
    setForm(BLANK_FORM)
    if (justCleared) onCelebrate()
  }

  function addRoute(): void {
    const name = form.name.trim()
    if (name === '') return
    // The database makes a new route the active one.
    void window.library
      .addRoute({
        gameId,
        name,
        color: form.color,
        playSeconds: formSeconds(form),
        cleared: form.cleared
      })
      .then(setRoutes)
    setForm(BLANK_FORM)
    setView('default')
  }

  function deleteRoute(id: number): void {
    void window.library.deleteRoute(gameId, id).then(setRoutes)
  }

  return (
    <>
      <div
        className={`route-panel ${open ? 'open' : ''}`}
        style={{ left: `${left}px`, bottom: `${bottom}px` }}
        aria-hidden={!open}
      >
        {/* Penpot: Pie Chart — 416x387; hidden while the manage face is out */}
        {view === 'default' ? (
          <div className="rp-pie" ref={pieRef}>
            {/* Penpot: Decolation — 416x77; two 98x65 wedges and a 164x2 rule */}
            <div className="rp-decoration">
              <svg className="rp-wing" viewBox="0 0 98 65">
                <path d="M0,0 L0,65 L98,0 Z" />
              </svg>
              <div className="rp-rule" />
              <svg className="rp-wing" viewBox="0 0 98 65">
                <path d="M98,0 L98,65 L0,0 Z" />
              </svg>
            </div>

            {/* Penpot: Circle — the 350x350 plate, with the routes' play time
              drawn as a ring on it. */}
            <div key={reveal} className={`rp-circle ${slices.length > 0 ? 'charted' : ''}`}>
              <PieChart
                slices={slices}
                reveal={reveal}
                /* The wedge under the pointer is lit and the rest held back —
                   the same thing the PlayTime Graph's ring does, this being the
                   same chart. */
                highlight={hovered ? String(hovered.route.id) : null}
                onSliceHover={(key, event) => {
                  const route = timed.find((one) => String(one.id) === key)
                  if (route) trackPointer(event, route)
                }}
                onSliceLeave={() => setHovered(null)}
              />
              {/* Penpot puts "TIME / RECORD" here; once the ring has something to
                show, the middle carries what it adds up to instead. */}
              {slices.length > 0 ? (
                <span className="rp-circle-label total">{formatPlaytime(totalSeconds)}</span>
              ) : (
                <span className="rp-circle-label">
                  TIME
                  <br />
                  RECORD
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Penpot: Route Maneger — 416x225 on the default face, the whole 612 on
          the manage one */}
        <div className="rp-manager">
          {view === 'default' ? (
            /* Penpot: Active Route — 416x123 */
            <div className="rp-active">
              <span className="rp-active-label">Active Route</span>
              <div className="rp-heroine">
                <button
                  type="button"
                  className="rp-step left"
                  onClick={() => step(-1)}
                  disabled={routes.length === 0}
                  aria-label="前のルート"
                >
                  <span>◀</span>
                </button>
                <div className="rp-name">
                  {active ? (
                    <span style={{ color: active.color }}>{active.name}</span>
                  ) : (
                    <span className="off">記録しない</span>
                  )}
                </div>
                <button
                  type="button"
                  className="rp-step right"
                  onClick={() => step(1)}
                  disabled={routes.length === 0}
                  aria-label="次のルート"
                >
                  <span>▶</span>
                </button>
              </div>
            </div>
          ) : (
            /* Penpot: Add Route Menu — 416x510 */
            <div className="rp-menu">
              {/* Penpot: Tab Name — 356x47; the selected tab carries the pill */}
              <div className="rp-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'add'}
                  className={`rp-tab ${tab === 'add' ? 'selected' : ''}`}
                  onClick={() => selectTab('add')}
                >
                  <span className="rp-tab-pill">
                    <span className="rp-tab-label">ADD</span>
                  </span>
                </button>
                <div className="rp-tab-divider" />
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'change'}
                  className={`rp-tab ${tab === 'change' ? 'selected' : ''}`}
                  onClick={() => selectTab('change')}
                >
                  <span className="rp-tab-pill">
                    <span className="rp-tab-label">CHANGE</span>
                  </span>
                </button>
              </div>

              {/* Penpot: Border — 356x2 */}
              <div className="rp-menu-rule" />

              {tab === 'add' || editing ? (
                /* Penpot: Add — 356x429; the editor is the same board */
                <div className="rp-add">
                  {/* Penpot: Route Name — 356x108 */}
                  <div className="rp-field">
                    <span className="rp-label">Route Name</span>
                    <div className="rp-input">
                      <input
                        value={form.name}
                        placeholder="Name..."
                        maxLength={40}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && addRoute()}
                        aria-label="ルート名"
                      />
                    </div>
                  </div>

                  {/* Penpot: Color — 356x196 */}
                  <div className="rp-field">
                    <span className="rp-label">Color</span>
                    {/* Penpot: Color Setting — 356x132, 15px between the two */}
                    <div className="rp-color-setting">
                      {/* Penpot: Color Option — 211x132 */}
                      <div className="rp-color-option">
                        <div className="rp-input">
                          <input
                            value={form.color}
                            placeholder="Color Code..."
                            maxLength={7}
                            spellCheck={false}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                color: e.target.value.replace(/[^#0-9a-fA-F]/g, '').slice(0, 7)
                              })
                            }
                            aria-label="カラーコード"
                          />
                          {/* The colour itself, read off the end of the field it
                            is written in. */}
                          <span
                            className="rp-color-dot"
                            style={{
                              background: HEX.test(form.color) ? form.color : 'transparent'
                            }}
                          />
                        </div>
                        {/* Penpot: Template Color — 211x78, 5 across by 2 down */}
                        <div className="rp-swatches">
                          {SWATCHES.map((color) => (
                            <button
                              type="button"
                              key={color}
                              className={`rp-swatch ${
                                color.toLowerCase() === form.color.toLowerCase() ? 'selected' : ''
                              }`}
                              style={{ background: color }}
                              onClick={() => setForm({ ...form, color })}
                              aria-label={color}
                            />
                          ))}
                        </div>
                      </div>
                      {/* Penpot draws a 130x132 plate here. It is the picker: a
                        hue strip over the square that cuts saturation and
                        brightness out of the hue it names. */}
                      <div className="rp-picker">
                        <input
                          type="range"
                          className="rp-hue"
                          min={0}
                          max={359}
                          value={hue}
                          onChange={(e) => pickHue(Number(e.target.value))}
                          aria-label="色相"
                        />
                        <div
                          className="rp-sv"
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
                            className="rp-sv-marker"
                            style={{
                              left: `${saturation * 100}%`,
                              top: `${(1 - brightness) * 100}%`
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Penpot: Default PlayTime — 356x54 */}
                  <div className="rp-row">
                    {/* Penpot carries both labels in this board — "Total
                      Playtime" is the hidden one, for a route that already
                      exists. */}
                    <span className="rp-label">
                      {editing ? 'Total Playtime' : 'Default Playtime'}
                    </span>
                    {/* Penpot: Play time — 116x34 */}
                    <div className="rp-playtime">
                      {/* Both fields are two or three digits, so a click means
                        "type a new value" rather than "put the caret here". */}
                      <input
                        className="rp-time-input"
                        inputMode="numeric"
                        value={form.hours}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            hours: digitsOnly(e.target.value, 4)
                          })
                        }
                        onBlur={() => form.hours === '' && setForm({ ...form, hours: '0' })}
                        aria-label="規定プレイ時間（時）"
                      />
                      <div className="rp-time-colon">
                        <span>:</span>
                      </div>
                      <input
                        className="rp-time-input"
                        inputMode="numeric"
                        value={form.minutes}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            minutes: digitsOnly(e.target.value, 2, 59)
                          })
                        }
                        onBlur={() => form.minutes === '' && setForm({ ...form, minutes: '0' })}
                        aria-label="規定プレイ時間（分）"
                      />
                    </div>
                  </div>

                  {/* Penpot: Is Cleared — 356x54 */}
                  <label className="rp-row">
                    <span className="rp-label">Cleard</span>
                    <input
                      type="checkbox"
                      className="rp-check"
                      checked={form.cleared}
                      onChange={(e) => setForm({ ...form, cleared: e.target.checked })}
                    />
                  </label>
                </div>
              ) : (
                /* Penpot: Change — 356x429; one Column per route */
                <div className="rp-change">
                  {routes.map((route) => (
                    <div
                      className="rp-column"
                      key={route.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEdit(route)}
                      onKeyDown={(e) => e.key === 'Enter' && openEdit(route)}
                      title={`${route.name} を編集`}
                    >
                      <span className="rp-column-name" style={{ color: route.color }}>
                        {route.name}
                      </span>
                      {/* Penpot: Delete — 39x39, out only on the hovered row */}
                      <button
                        type="button"
                        className="rp-column-delete"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleting(route)
                        }}
                        title="このルートを削除"
                        aria-label={`${route.name} を削除`}
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Penpot: Border — 356x2 */}
              <div className="rp-menu-rule" />
            </div>
          )}

          {/* Penpot: Add Route Button — 416x102 */}
          <div className="rp-button-row">
            {view === 'default' ? (
              /* Penpot: Default Button — 366x52 */
              <button type="button" className="rp-button" onClick={() => setView('manage')}>
                <span>MANEGE ROUTE</span>
              </button>
            ) : (
              /* Penpot: Add Route Menu Buttons — 366x52, 30px between them. The
               design puts CANCEL first; the two are the other way round here.
               The Change list has nothing to abandon, so it carries OK alone,
               across the whole 366; the editor it opens has both again. */
              <>
                <button
                  type="button"
                  className="rp-button ok"
                  disabled={(tab === 'add' || editing !== null) && form.name.trim() === ''}
                  onClick={() => {
                    if (editing) commitEdit()
                    else if (tab === 'add') addRoute()
                    else setView('default')
                  }}
                >
                  <span>OK</span>
                </button>
                {tab === 'add' || editing ? (
                  <button
                    type="button"
                    className="rp-button cancel"
                    onClick={() => {
                      // From the editor CANCEL is "back to the list"; from Add it
                      // is "leave the menu".
                      if (editing) {
                        setEditing(null)
                        setForm(BLANK_FORM)
                      } else {
                        setView('default')
                      }
                    }}
                  >
                    <span>CANCEL</span>
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Penpot board "Delete Image Confilm", asking after a route instead of a
          picture. It stands in the middle of this board rather than over the
          window, so it is scaled to sit inside it — see `.route-panel
          .delete-confirm`. */}
        {deleting ? (
          <ConfirmDialog
            title="delete route"
            message="このルートを削除しますか？"
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              deleteRoute(deleting.id)
              setDeleting(null)
            }}
          />
        ) : null}
      </div>

      {/* Penpot board "Hover Pie Route" — 260x118, the segment's own name and
        what it has on the clock. It follows the pointer wherever it goes, so it
        is a sibling of the board rather than a child: the board clips what is
        inside it. Placed in the same "Under" coordinates the board is, which is
        what turns a point in the Pie Chart into one of them. */}
      {open && hovered ? (
        <div
          className="rp-hover-pie"
          style={{
            left: `${left + hovered.x}px`,
            bottom: `${bottom + 612 - hovered.y - HOVER_H}px`
          }}
        >
          <span className="rp-hover-name" style={{ color: hovered.route.color }}>
            {hovered.route.name}
          </span>
          <span className="rp-hover-time">{formatRouteTime(hovered.route.playSeconds)}</span>
        </div>
      ) : null}
    </>
  )
}
