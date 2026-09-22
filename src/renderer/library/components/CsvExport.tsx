import { useMemo, useRef, useState } from 'react'
import type { GameWithStats, Group, Tag } from '../../../shared/db-types'
import { filterGames, suggestsGroup } from '../filter'
import { displayName } from '../sort'
import { formatPlaytime } from '../format'
import { t } from '../../../shared/i18n'
import { mediaUrl } from '../../../shared/media-url'
import ConfirmDialog from './ConfirmDialog'
import OptionMenu from './OptionMenu'
import './CsvExport.css'

/** A CSV cell: quoted and its quotes doubled only where it carries a comma, a
    quote or a newline. */
function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** One exportable column: the field's own key and the name the design writes. */
interface Column {
  key: string
  label: string
}

// i18n-keys
const LEFT_COLUMNS: Column[] = [
  { key: 'title', label: 'ゲーム名' },
  { key: 'shortName', label: 'ゲーム名 (Short)' },
  { key: 'group', label: 'グループ名' },
  { key: 'tags', label: 'タグ' },
  { key: 'exePath', label: '実行ファイルの場所' },
  { key: 'brand', label: 'ブランド名' },
  { key: 'releaseDate', label: '発売日' },
  { key: 'listPrice', label: '定価' },
  { key: 'progress', label: '進行状況' }
]
// i18n-keys
const RIGHT_COLUMNS: Column[] = [
  { key: 'purchaseDate', label: '購入日' },
  { key: 'purchasePrice', label: '購入金額' },
  { key: 'sellDate', label: '売却日' },
  { key: 'sellPrice', label: '売却金額' },
  { key: 'median', label: '中央値' },
  { key: 'average', label: '平均値' },
  { key: 'totalPlayTime', label: '総プレイ時間' },
  { key: 'lastPlayed', label: '最終プレイ日' },
  { key: 'route', label: 'ルート' }
]
const ALL_COLUMN_KEYS = [...LEFT_COLUMNS, ...RIGHT_COLUMNS].map((c) => c.key)

/** The row for no group at all, which clears the filter. */
const ALL_GROUPS_KEY = '__all__'

interface Props {
  games: GameWithStats[]
  groups: Group[]
  tags: Tag[]
  onClose: () => void
}

/**
 * Penpot boards "CSV Game" (550x986) and "CSV Setting" (818x736), shown side by
 * side as one dialog on the shared backdrop — the game picker on the left, the
 * column picker and save row on the right. This is a first pass read off the
 * design: what it draws is wired up (the game list, its search and group
 * filter, the two check-all buttons, the column checkboxes, and the 参照
 * directory picker); writing the CSV itself is the next step.
 */
export default function CsvExport({ games, groups, tags, onClose }: Props): React.JSX.Element {
  // Every game starts unchecked; the player picks what to export.
  const [selected, setSelected] = useState<Set<number>>(() => new Set<number>())
  const [search, setSearch] = useState('')
  /* The Group field is the Home board's own: what is typed narrows the menu's
     suggestions by prefix (`groupText`), and the list is filtered by the group
     of exactly the name that has been settled on (`groupName`). */
  const [groupText, setGroupText] = useState('')
  const [groupName, setGroupName] = useState('')
  /* Which board is out: the whole list (dropped by the ▼) or the suggestions
     the typed text narrows it to. */
  const [groupMenu, setGroupMenu] = useState<null | 'list' | 'suggest'>(null)
  const groupRowRef = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState<Set<string>>(() => new Set(ALL_COLUMN_KEYS))
  const [path, setPath] = useState('')
  /* True while the file is being written, and the notice shown once it is —
     success carries the saved path, failure the reason. */
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)

  const filtered = useMemo(
    () => filterGames(games, tags, { query: search, group: groupName, tagTerms: [] }),
    [games, tags, search, groupName]
  )

  /* The whole list under the ▼ (with すべて over it), or the names beginning
     with what has been typed under the field. */
  const groupOptions = useMemo(() => {
    if (groupMenu === null) return []
    const rows = groups.map((group) => ({
      key: String(group.id),
      label: group.name,
      // Each name in its own group's colour, the way every other group list
      // draws it — the side panel's, the Home board's and the graph's.
      color: group.color,
      current: group.name === groupName
    }))
    if (groupMenu === 'list') return [{ key: ALL_GROUPS_KEY, label: t('すべて') }, ...rows]
    return rows.filter((row) => suggestsGroup(row.label, groupText))
  }, [groups, groupMenu, groupText, groupName])

  const commitGroup = (text: string): void => {
    setGroupText(text)
    setGroupName(text)
  }
  const openSuggestions = (text: string): void =>
    setGroupMenu((open) => (text.trim() ? 'suggest' : open === 'suggest' ? null : open))

  const toggleGame = (id: number): void =>
    setSelected((set) => {
      const next = new Set(set)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleColumn = (key: string): void =>
    setColumns((set) => {
      const next = new Set(set)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  /* The two buttons check or uncheck every game the list currently shows, so a
     search or a group narrows what they act on. */
  const setAll = (on: boolean): void =>
    setSelected((set) => {
      const next = new Set(set)
      for (const game of filtered) {
        if (on) next.add(game.id)
        else next.delete(game.id)
      }
      return next
    })

  async function pickDirectory(): Promise<void> {
    const dir = await window.library.pickBackupDirectory()
    if (dir) setPath(dir)
  }

  /* Builds the CSV — the selected columns, in the boards' own left-then-right
     order, over the selected games — and hands the bytes to the main process to
     write. The sell figures come from the ledger and the routes from each
     game's own list, both read here; everything else is on the game already. */
  async function runExport(): Promise<void> {
    setBusy(true)
    try {
      const chosen = games.filter((game) => selected.has(game.id))
      const cols = [...LEFT_COLUMNS, ...RIGHT_COLUMNS].filter((c) => columns.has(c.key))

      // The latest buy and sell per game, out of the ledger — the same book the
      // Ledger board reads.
      const ledger = await window.library.listLedgerEntries()
      const buys = new Map<number, { date: string; price: number }>()
      const sells = new Map<number, { date: string; price: number }>()
      for (const entry of ledger) {
        if (entry.gameId == null) continue
        const into = entry.kind === 'buy' ? buys : entry.kind === 'sell' ? sells : null
        if (!into) continue
        const cur = into.get(entry.gameId)
        if (!cur || entry.date > cur.date) into.set(entry.gameId, { date: entry.date, price: entry.price })
      }
      /* The Add Game panel's own purchase counts as a buy too — dated by its
         purchase date, or the day the game was registered where the panel left
         that blank — and it wins only where it is later than any ledger buy, so
         a ledger buy on the same day supersedes it the way the Ledger board's
         own merge does. */
      for (const game of chosen) {
        if (game.purchasePrice == null) continue
        const date = game.purchaseDate ?? game.createdAt.slice(0, 10)
        const cur = buys.get(game.id)
        if (!cur || date > cur.date) buys.set(game.id, { date, price: game.purchasePrice })
      }
      // Each game's routes, written as name(playtime) — with ", clear" added
      // inside the parentheses for a route that has been cleared.
      const routesByGame = new Map<number, string>()
      await Promise.all(
        chosen.map(async (game) => {
          const list = await window.library.listRoutes(game.id)
          routesByGame.set(
            game.id,
            list
              .map(
                (route) =>
                  `${route.name}(${formatPlaytime(route.playSeconds)}${route.cleared ? ', clear' : ''})`
              )
              .join(';')
          )
        })
      )

      const tagName = (id: number): string => tags.find((one) => one.id === id)?.name ?? ''
      const value = (game: GameWithStats, key: string): string => {
        switch (key) {
          case 'title':
            return game.title
          case 'shortName':
            return game.shortName ?? ''
          case 'group':
            return game.groupName ?? ''
          case 'tags':
            return game.tagIds.map(tagName).filter(Boolean).join(';')
          case 'exePath':
            return game.exePath
          case 'brand':
            return game.brand ?? ''
          case 'releaseDate':
            return game.releaseDate ?? ''
          case 'listPrice':
            return game.listPrice != null ? String(game.listPrice) : ''
          case 'progress': {
            const state = game.progressState ?? (game.stats.hasSessions ? 'playing' : 'unplayed')
            return t(state === 'cleared' ? 'クリア済み' : state === 'playing' ? 'プレイ中' : '未プレイ')
          }
          case 'purchaseDate':
            return buys.get(game.id)?.date ?? ''
          case 'purchasePrice': {
            const buy = buys.get(game.id)
            return buy ? String(buy.price) : ''
          }
          case 'sellDate':
            return sells.get(game.id)?.date ?? ''
          case 'sellPrice': {
            const sell = sells.get(game.id)
            return sell ? String(sell.price) : ''
          }
          case 'median':
            return game.medianScore != null ? String(game.medianScore) : ''
          case 'average':
            return game.averageScore != null ? String(game.averageScore) : ''
          case 'totalPlayTime':
            return formatPlaytime(game.stats.totalPlaySeconds)
          case 'lastPlayed':
            return game.stats.lastPlayedAt ? game.stats.lastPlayedAt.slice(0, 10) : ''
          case 'route':
            return routesByGame.get(game.id) ?? ''
          default:
            return ''
        }
      }

      const header = cols.map((c) => escapeCell(t(c.label))).join(',')
      const body = chosen.map((game) => cols.map((c) => escapeCell(value(game, c.key))).join(','))
      const content = [header, ...body].join('\r\n')

      const saved = await window.library.exportCsv(path.trim(), content)
      setNotice({ ok: true, message: t('CSVを書き出しました。\n{0}', saved) })
    } catch (err) {
      setNotice({
        ok: false,
        message: t('CSVを書き出せませんでした。\n{0}', err instanceof Error ? err.message : String(err))
      })
    } finally {
      setBusy(false)
    }
  }

  const renderColumn = (column: Column): React.JSX.Element => {
    const on = columns.has(column.key)
    return (
      <button
        key={column.key}
        type="button"
        className="csv-col-row"
        onClick={() => toggleColumn(column.key)}
      >
        <span className={`csv-box csv-col-check${on ? ' on' : ''}`} />
        {t(column.label)}
      </button>
    )
  }

  return (
    <>
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="csv-export" onClick={(event) => event.stopPropagation()}>
        {/* ── CSV Game ── */}
        <div className="csv-game">
          <div className="csv-game-left">
            <div className="csv-game-head">
              <div className="csv-search">
                <input
                  className="csv-search-input"
                  placeholder="Search..."
                  spellCheck={false}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="csv-group-row" ref={groupRowRef}>
                {/* Typed into like the Home board's Group field: prefix
                    suggestions as you type, and the ▼ is the only thing that
                    drops the whole list. */}
                <div className="csv-group-field">
                  <input
                    className="csv-group-input"
                    placeholder="Group..."
                    spellCheck={false}
                    value={groupText}
                    onChange={(event) => {
                      const text = event.target.value.trim() ? event.target.value : ''
                      if (text) setGroupText(text)
                      else commitGroup('')
                      openSuggestions(text)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                      commitGroup(groupText)
                      setGroupMenu(null)
                    }}
                    onFocus={() => openSuggestions(groupText)}
                    onBlur={() => {
                      commitGroup(groupText)
                      setGroupMenu((open) => (open === 'suggest' ? null : open))
                    }}
                  />
                </div>
                <span className="csv-group-divider" />
                <button
                  type="button"
                  className="csv-group-caret"
                  onClick={() => setGroupMenu((open) => (open === 'list' ? null : 'list'))}
                  aria-expanded={groupMenu !== null}
                >
                  ▼
                </button>
                {groupMenu && groupOptions.length > 0 && (
                  <OptionMenu
                    options={groupOptions}
                    top={60}
                    left={0}
                    width={582}
                    maxRows={8}
                    onPick={(key) => {
                      commitGroup(
                        key === ALL_GROUPS_KEY
                          ? ''
                          : (groups.find((g) => String(g.id) === key)?.name ?? '')
                      )
                      setGroupMenu(null)
                    }}
                    onDismiss={() => setGroupMenu(null)}
                    anchorRef={groupRowRef}
                  />
                )}
              </div>
            </div>

            <div className="csv-game-list">
              {filtered.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className="csv-game-row"
                  onClick={() => toggleGame(game.id)}
                >
                  <span className={`csv-box${selected.has(game.id) ? ' on' : ''}`} />
                  {/* The game's own icon in place of the design's colour
                      square. */}
                  {game.iconPath ? (
                    <img
                      className="csv-game-icon"
                      src={mediaUrl(game.iconPath)}
                      alt=""
                      draggable={false}
                    />
                  ) : (
                    <span className="csv-game-icon" />
                  )}
                  {/* The full name on hover, for read-aloud. */}
                  <span className="csv-game-title" title={displayName(game)}>
                    {displayName(game)}
                  </span>
                </button>
              ))}
            </div>

            <div className="csv-game-rule" />

            <div className="csv-check-way">
              <button type="button" className="csv-all-check" onClick={() => setAll(true)}>
                {t('すべてチェック')}
              </button>
              <button type="button" className="csv-all-uncheck" onClick={() => setAll(false)}>
                {t('すべてアンチェック')}
              </button>
            </div>
          </div>
        </div>

        {/* ── CSV Setting ── */}
        <div className="csv-setting">
          <div className="csv-setting-left">{LEFT_COLUMNS.map(renderColumn)}</div>
          <div className="csv-setting-vrule" />
          <div className="csv-setting-right">{RIGHT_COLUMNS.map(renderColumn)}</div>
          <div className="csv-setting-hrule" />
          <div className="csv-setting-bottom">
            <div className="csv-path">
              <span className="csv-path-label">{t('保存先のディレクトリ')}</span>
              <div className="csv-path-box">
                <input
                  className="csv-path-input"
                  placeholder="PATH..."
                  spellCheck={false}
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                />
                <button type="button" className="csv-path-ref" onClick={() => void pickDirectory()}>
                  {t('参照')}
                </button>
              </div>
            </div>
            <div className="csv-actions">
              <button type="button" className="csv-cancel" onClick={onClose}>
                cancel
              </button>
              {/* Off until a directory is named and there is something to
                  write, and while a write is running. */}
              <button
                type="button"
                className="csv-ok"
                disabled={!path.trim() || busy || selected.size === 0 || columns.size === 0}
                onClick={() => void runExport()}
              >
                ok
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Where the file went, or why it could not be written. On success the
        whole dialog is closed; on failure it stays so the path can be fixed. */}
    {notice && (
      <ConfirmDialog
        title="CSV"
        message={notice.message}
        onConfirm={() => (notice.ok ? onClose() : setNotice(null))}
      />
    )}
    </>
  )
}
