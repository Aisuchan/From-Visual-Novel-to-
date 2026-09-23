import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import type {
  AppSettings,
  DayPlaytime,
  DayGamePlaytime,
  NewPlanInput,
  Plan,
  FooterStats,
  GameImage,
  GameReference,
  GameWithStats,
  Group,
  HomeColumns,
  HomeLayout,
  HomeSpines,
  LaunchPrefs,
  NewGameInput,
  NewGroupInput,
  NewRouteInput,
  PlayAdjustment,
  ProgressState,
  Route,
  RoutePatch,
  Session,
  Tag,
  NewVoiceInput,
  Voice,
  VoiceCharacter,
  VoicePatch,
  LedgerEntry,
  NewLedgerEntryInput
} from '../shared/db-types'
import { t } from '../shared/i18n'
import {
  GPU_MODES,
  VNDB_RELEASE_LANGUAGES,
  GRAPH_PERIODS,
  HOME_COLUMNS,
  HOME_SPINES,
  OVERLAY_CORNERS,
  OVERLAY_SIZES
} from '../shared/db-types'

let db: Database.Database

export function initDb(): void {
  const dbDir = app.getPath('userData')
  fs.mkdirSync(dbDir, { recursive: true })
  db = new Database(path.join(dbDir, 'library.sqlite3'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      short_name TEXT,
      thumbnail_path TEXT,
      icon_path TEXT,
      exe_path TEXT NOT NULL,
      group_name TEXT,
      use_exe_icon INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      recorded INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS game_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      source_path TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_game_images_game ON game_images(game_id);

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      play_seconds INTEGER NOT NULL DEFAULT 0,
      cleared INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_routes_game ON routes(game_id);

    CREATE TABLE IF NOT EXISTS play_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      seconds INTEGER NOT NULL,
      route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
      route_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_play_adjustments_game ON play_adjustments(game_id);

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_tags (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (game_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL,
      notify INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_plans_date ON plans(date);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voice_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS voices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
      character_id INTEGER REFERENCES voice_characters(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      source_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      price REAL NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_entries(date);

    CREATE TABLE IF NOT EXISTS launch_prefs (
      game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      use_recorder_panel INTEGER NOT NULL DEFAULT 1,
      run_as_admin INTEGER NOT NULL DEFAULT 0,
      keep_setting INTEGER NOT NULL DEFAULT 0
    );
  `)

  // A thumbnail chosen in the Add Game dialog never went through the gallery,
  // so it would be missing from the Add Thumbnail grid. Adopt any that predate
  // this (the guard makes it a no-op from then on).
  db.exec(`
    INSERT INTO game_images (game_id, file_path, source)
    SELECT id, thumbnail_path, 'manual' FROM games
    WHERE thumbnail_path IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM game_images
        WHERE game_images.game_id = games.id AND game_images.file_path = games.thumbnail_path
      )
  `)

  addMissingColumns('game_images', {
    // The file the picture was copied *from*, which is what its row in the
    // gallery opens the folder on. Null on every row made before it existed.
    source_path: 'TEXT',
    /* Where the picture stands in the gallery, which the grid's drag writes.
       **Every row made before this column existed carries 0**, and the list is
       ordered by it and then by id — so an untouched gallery is in exactly the
       insertion order it always was, and a gallery that has been dragged is in
       the order it was left. A picture added afterwards takes the next number
       up rather than the default, or it would arrive at the front of a list
       somebody had ordered. */
    sort_order: 'INTEGER NOT NULL DEFAULT 0',
    /* Marked R18 from the cell's own menu. It is what the Extra Function
       board's green circle draws from, and the cell's frame goes red for it. */
    is_r18: 'INTEGER NOT NULL DEFAULT 0'
  })

  addMissingColumns('launch_prefs', {
    record_time: 'INTEGER NOT NULL DEFAULT 1'
  })

  addMissingColumns('routes', {
    // Set when a route is marked cleared, for the Play log's own row.
    cleared_at: 'TEXT',
    clear_play_seconds: 'INTEGER'
  })

  addMissingColumns('games', {
    use_short_name: 'INTEGER NOT NULL DEFAULT 0',
    use_thumbnail_default: 'INTEGER NOT NULL DEFAULT 0',
    // Manual correction to the total play time, kept as an offset so sessions
    // recorded after the edit still accumulate on top of it.
    play_time_offset: 'INTEGER NOT NULL DEFAULT 0',
    // What the Progress triangle reads. NULL leaves it to the play history.
    progress_state: 'TEXT',
    // Game Info's RELEASE DATE and MEDIAN, which the Sort field also orders by.
    // The ErogeScape/VNDB import that would fill them is deferred.
    release_date: 'TEXT',
    // Which language's release that date is, where it came off a page that
    // lists one per language; see `Game.releaseLanguage`.
    release_language: 'TEXT',
    median_score: 'REAL',
    // ErogameScape's average beside its median; see `Game.averageScore`.
    average_score: 'REAL',
    // And the studio, and the page the three of them were read from.
    brand: 'TEXT',
    reference_url: 'TEXT',
    // The Add Game dialog's advanced panel: when the game was bought and for
    // how much. A bare number, the unit being the app's own currency.
    purchase_date: 'TEXT',
    purchase_price: 'REAL',
    // The advanced panel's list price (定価), a bare number in the app's own
    // currency the same way the purchase price is.
    list_price: 'REAL',
    clear_score: 'INTEGER',
    cleared_at: 'TEXT',
    clear_play_seconds: 'INTEGER',
    // The picture each of the Home board's faces was given from its own cell.
    // They are that face's and nothing else's, so they are columns here rather
    // than rows in `game_images`, which is the Add Thumbnail gallery's list.
    home_card_image: 'TEXT',
    home_spine_image: 'TEXT',
    // Where the Recorder Panel was left for this game — the fixed corner it
    // folds and grows from, in screen pixels — so the next play brings it back
    // there rather than to the Setting board's default corner. NULL until the
    // panel has been moved for the game at least once.
    panel_x: 'INTEGER',
    panel_y: 'INTEGER'
  })

  /* `play_time_offset` used to be stored against the sum over every session.
     Now that the stats only add up the ones launched with "Record Time" on,
     an offset written back then is short by whatever the unrecorded sessions
     came to — enough, on a game with a hand-edited total, to hold TOTAL PLAY
     at 00:00:00 while new sessions pile up underneath it. Rebase them once so
     they mean the same thing again. */
  if (db.pragma('user_version', { simple: true }) === 0) {
    db.exec(`
      UPDATE games SET play_time_offset = play_time_offset + COALESCE((
        SELECT SUM(duration_seconds) FROM sessions
        WHERE sessions.game_id = games.id AND sessions.recorded = 0
      ), 0)
      WHERE play_time_offset <> 0
    `)
    db.pragma('user_version = 1')
  }

  /* The common route used to be seeded in the slate the app sets dim text in.
     Only the ones still holding that exact value are moved to the new colour,
     so a route recoloured by hand keeps what it was given. */
  if (db.pragma('user_version', { simple: true }) === 1) {
    db.prepare("UPDATE routes SET color = ? WHERE name = ? AND color = '#6f8193'").run(
      COMMON_ROUTE_COLOR,
      COMMON_ROUTE_NAME
    )
    db.pragma('user_version = 2')
  }

  addMissingColumns('play_adjustments', {
    /* An edit the player asked to count as play: its seconds live in this
       session rather than in `play_time_offset`, so the footer, the Calender
       board and the graph pick it up. See `setTotalPlaySeconds`. */
    session_id: 'INTEGER REFERENCES sessions(id) ON DELETE SET NULL'
  })
}

/** SQLite has no `ADD COLUMN IF NOT EXISTS`, so check the table first. */
function addMissingColumns(table: string, columns: Record<string, string>): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
  )
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
    }
  }
}

/* The sessions that are hand edits rather than launches (`setTotalPlaySeconds`
   with `asPlayed`). They count wherever time is summed — that is what they are
   for — and nowhere a session means the game was opened: the last-played
   stamp, the Progress triangle's "played at all", and the Play log's rows. */
const ADJUSTMENT_SESSIONS =
  '(SELECT session_id FROM play_adjustments WHERE session_id IS NOT NULL)'

function rowToGameWithStats(row: any): GameWithStats {
  const stats = db
    .prepare(
      /* Sessions launched with "Record Time" off are kept as history but left
         out of the stats the library shows. */
      /* `last` is the last *launch*: a session standing for a hand edit
         (see `ADJUSTMENT_SESSIONS`) counts in the total and not here, the
         game not having been opened by it. */
      `SELECT COALESCE(SUM(duration_seconds), 0) AS total,
              MAX(CASE WHEN id IN ${ADJUSTMENT_SESSIONS} THEN NULL ELSE started_at END) AS last
       FROM sessions WHERE game_id = ? AND recorded = 1`
    )
    .get(row.id) as { total: number; last: string | null }

  /* The Progress triangle's "played at all" reads the same rows the Play log
     puts a GAME START on, which includes the ones launched with "Record Time"
     off — so it is counted separately from the stats above. */
  const launched = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM sessions
         WHERE game_id = ? AND ended_at IS NOT NULL AND id NOT IN ${ADJUSTMENT_SESSIONS}`
      )
      .get(row.id) as { n: number }
  ).n

  const tagIds = (
    db.prepare('SELECT tag_id FROM game_tags WHERE game_id = ? ORDER BY tag_id').all(row.id) as {
      tag_id: number
    }[]
  ).map((tag) => tag.tag_id)

  return {
    id: row.id,
    title: row.title,
    shortName: row.short_name,
    thumbnailPath: row.thumbnail_path,
    homeCardImage: row.home_card_image ?? null,
    homeSpineImage: row.home_spine_image ?? null,
    iconPath: row.icon_path,
    exePath: row.exe_path,
    groupName: row.group_name,
    useExeIcon: !!row.use_exe_icon,
    useShortName: !!row.use_short_name,
    useThumbnailAsDefault: !!row.use_thumbnail_default,
    progressState: (row.progress_state as GameWithStats['progressState']) ?? null,
    releaseDate: row.release_date ?? null,
    releaseLanguage: row.release_language ?? null,
    medianScore: row.median_score ?? null,
    averageScore: row.average_score ?? null,
    brand: row.brand ?? null,
    purchaseDate: row.purchase_date ?? null,
    purchasePrice: row.purchase_price ?? null,
    listPrice: row.list_price ?? null,
    referenceUrl: row.reference_url ?? null,
    clearScore: row.clear_score ?? null,
    tagIds,
    clearedAt: row.cleared_at ?? null,
    clearPlaySeconds: row.clear_play_seconds ?? null,
    createdAt: row.created_at,
    stats: {
      totalPlaySeconds: Math.max(0, stats.total + (row.play_time_offset ?? 0)),
      lastPlayedAt: stats.last,
      hasSessions: launched > 0
    }
  }
}

/**
 * Stores the difference between the requested total and what the recorded
 * sessions add up to, so later sessions keep incrementing from the new value.
 *
 * **What the total is moved by, the active route is moved by too — and the log
 * is told.** A session is banked on whichever route is active as it ends, so
 * the routes' figures are shares of the total; a total edited by hand without
 * the routes following it left them adding up to something the board no
 * longer said. The delta goes on the active route, held at zero the way a
 * route's own figure is (a subtraction past what the route holds takes it to
 * nothing, not below), and nowhere while the stepper stands on 記録しない —
 * exactly as a session's time does. The edit itself is written down as a row
 * of its own (`play_adjustments`), which is what the Play log draws and what a
 * right press on that row undoes.
 *
 * **Asked to count as play, the time goes in as a session instead.** The
 * footer's totals, the Calender board's days and the graph are all sums over
 * `sessions`, and an offset on the game reaches none of them: three hours
 * added by hand raised TOTAL PLAY and nothing else. With `asPlayed` the delta
 * is written as a session of its own — dated now, so it lands on today — and
 * the offset is left alone; the game's total comes to the same figure either
 * way, being the sessions' sum plus the offset. The adjustment row keeps that
 * session's id (`session_id`), which is how the log knows to draw the edit
 * rather than a PLAYED row for it and how undoing the edit takes the session
 * away again. **A subtraction goes the same way, as a session of negative
 * length**: it comes off today, which is the one day a hand edit can be said
 * to be about. A day cannot be read as holding less than nothing, so every
 * reader that sums sessions by day or by span holds its figure at zero
 * (`getFooterStats`, `getPlaytimeByDay`, `getPlaytimeByDayAndGame`) — a
 * subtraction larger than today's play empties today and stops there, while
 * the game's own total, which is the sum over every session, still drops by
 * the whole of it.
 */
export function setTotalPlaySeconds(gameId: number, seconds: number, asPlayed = false): void {
  const recorded = (
    db
      .prepare(
        'SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM sessions WHERE game_id = ? AND recorded = 1'
      )
      .get(gameId) as { total: number }
  ).total
  const before = (
    db.prepare('SELECT play_time_offset AS offset FROM games WHERE id = ?').get(gameId) as
      | { offset: number }
      | undefined
  )?.offset
  if (before === undefined) return
  const offset = Math.round(seconds) - recorded
  const delta = offset - before
  if (delta === 0) return

  const active = listRoutes(gameId).find((route) => route.isActive) ?? null
  const write = db.transaction(() => {
    let sessionId: number | null = null
    if (asPlayed) {
      const now = new Date().toISOString()
      sessionId = Number(
        db
          .prepare(
            `INSERT INTO sessions (game_id, started_at, ended_at, duration_seconds, recorded)
             VALUES (?, ?, ?, ?, 1)`
          )
          .run(gameId, now, now, delta).lastInsertRowid
      )
    } else {
      db.prepare('UPDATE games SET play_time_offset = ? WHERE id = ?').run(offset, gameId)
    }
    if (active) {
      db.prepare(
        'UPDATE routes SET play_seconds = MAX(0, play_seconds + ?) WHERE id = ?'
      ).run(delta, active.id)
    }
    db.prepare(
      `INSERT INTO play_adjustments (game_id, seconds, route_id, route_name, session_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(gameId, delta, active?.id ?? null, active?.name ?? null, sessionId)
  })
  write()
}

function rowToAdjustment(row: {
  id: number
  game_id: number
  seconds: number
  route_id: number | null
  route_name: string | null
  current_name: string | null
  created_at: string
}): PlayAdjustment {
  return {
    id: row.id,
    gameId: row.game_id,
    seconds: row.seconds,
    routeId: row.route_id,
    /* The route's name as it is *now* where the route is still there, and the
       name it had where it is not: the log follows a rename and outlives a
       deletion, the way the design's own 「♡ CLEARED "HEROINE1"」 follows the
       route it is read off. */
    routeName: row.current_name ?? row.route_name,
    createdAt: row.created_at
  }
}

/** Every edit made to this game's TOTAL PLAY by hand, newest first. */
export function listPlayAdjustments(gameId: number): PlayAdjustment[] {
  return (
    db
      .prepare(
        `SELECT a.*, r.name AS current_name
         FROM play_adjustments a
         LEFT JOIN routes r ON r.id = a.route_id
         WHERE a.game_id = ?
         ORDER BY a.created_at DESC, a.id DESC`
      )
      .all(gameId) as Parameters<typeof rowToAdjustment>[0][]
  ).map(rowToAdjustment)
}

/**
 * Takes an edit off the log, and off the figures it moved: the total goes
 * back by what the edit moved it, and so does the route it was banked on
 * where that route is still there — held at zero, as it was on the way in.
 */
export function deletePlayAdjustment(gameId: number, adjustmentId: number): void {
  const row = db
    .prepare(
      'SELECT seconds, route_id, session_id FROM play_adjustments WHERE id = ? AND game_id = ?'
    )
    .get(adjustmentId, gameId) as
    | { seconds: number; route_id: number | null; session_id: number | null }
    | undefined
  if (!row) return
  const undo = db.transaction(() => {
    /* The time goes back out of wherever it went in: the session it was
       written as, or the offset. */
    if (row.session_id !== null) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id)
    } else {
      db.prepare('UPDATE games SET play_time_offset = play_time_offset - ? WHERE id = ?').run(
        row.seconds,
        gameId
      )
    }
    if (row.route_id !== null) {
      db.prepare('UPDATE routes SET play_seconds = MAX(0, play_seconds - ?) WHERE id = ?').run(
        row.seconds,
        row.route_id
      )
    }
    db.prepare('DELETE FROM play_adjustments WHERE id = ?').run(adjustmentId)
  })
  undo()
}

/** Keeps a thumbnail set outside the gallery listed in it all the same. */
function linkThumbnail(gameId: number, thumbnailPath: string | null): void {
  if (!thumbnailPath) return
  db.prepare(
    `INSERT INTO game_images (game_id, file_path, source)
     SELECT ?, ?, 'manual'
     WHERE NOT EXISTS (SELECT 1 FROM game_images WHERE game_id = ? AND file_path = ?)`
  ).run(gameId, thumbnailPath, gameId, thumbnailPath)
}

/**
 * The Add Thumbnail grid pages through these, so the order has to be stable as
 * images are added: **the order the grid was left in**, and inside that the
 * insertion order — oldest first, newest on the last page, which is what every
 * gallery that has never been dragged is still in, `sort_order` being 0 on all
 * of them.
 */
export function listGameImages(gameId: number): GameImage[] {
  const rows = db
    .prepare('SELECT * FROM game_images WHERE game_id = ? ORDER BY sort_order ASC, id ASC')
    .all(gameId) as {
    id: number
    game_id: number
    file_path: string
    source_path: string | null
    source: string
    is_r18: number
    created_at: string
  }[]

  return rows.map((row) => ({
    id: row.id,
    gameId: row.game_id,
    filePath: row.file_path,
    sourcePath: row.source_path ?? null,
    source:
      row.source === 'screenshot' || row.source === 'recording' ? row.source : 'manual',
    r18: row.is_r18 === 1,
    createdAt: row.created_at
  }))
}

/** Marks a picture R18, or unmarks it, and hands the list back. */
export function setGameImageR18(gameId: number, imageId: number, r18: boolean): GameImage[] {
  db.prepare('UPDATE game_images SET is_r18 = ? WHERE id = ? AND game_id = ?').run(
    r18 ? 1 : 0,
    imageId,
    gameId
  )
  return listGameImages(gameId)
}

/**
 * One entry drawn from every gallery in the library at once — the Extra
 * Function board's blue circle — so a game with a hundred pictures is a
 * hundred times as likely to answer as one with one. Null while there is
 * nothing in any of them.
 */
export function getRandomImage(r18Only = false): { gameId: number; imageId: number } | null {
  const row = db
    .prepare(
      `SELECT id, game_id FROM game_images ${r18Only ? 'WHERE is_r18 = 1' : ''}
       ORDER BY RANDOM() LIMIT 1`
    )
    .get() as { id: number; game_id: number } | undefined
  return row ? { gameId: row.game_id, imageId: row.id } : null
}

/**
 * Files pictures in a game's gallery.
 *
 * Each is the app's own copy under `userData` — that is what the grid draws
 * and what `fvn-media:` will serve — and `sourcePath` is where the copy was
 * taken from, which is the file the player themselves has. Nothing else in the
 * app reads it; 「ファイルの場所を開く」 does.
 */
export function addGameImages(
  gameId: number,
  files: { filePath: string; sourcePath?: string | null }[],
  source: GameImage['source'] = 'manual'
): GameImage[] {
  const insert = db.prepare(
    `INSERT INTO game_images (game_id, file_path, source_path, source, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  )
  /* A picture is filed at the end of the gallery, which is where the grid pages
     to when it is added. The column's own default is 0, which on a list
     somebody has dragged is the *front* — so the next number up is read off
     the list rather than left to the default. */
  const last = db
    .prepare('SELECT MAX(sort_order) AS last FROM game_images WHERE game_id = ?')
    .get(gameId) as { last: number | null }
  const tx = db.transaction((rows: typeof files) => {
    let order = (last.last ?? 0) + 1
    for (const row of rows) {
      insert.run(gameId, row.filePath, row.sourcePath ?? null, source, order)
      order += 1
    }
  })
  tx(files)
  return listGameImages(gameId)
}

/**
 * The order the Add Thumbnail grid was dragged into. Every row of the game is
 * rewritten, the way `reorderGames` rewrites the library: the list handed in is
 * the whole of the gallery, so its index is the row's place in it.
 */
export function reorderGameImages(gameId: number, orderedIds: number[]): GameImage[] {
  const update = db.prepare('UPDATE game_images SET sort_order = ? WHERE id = ? AND game_id = ?')
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => update.run(index, id, gameId))
  })
  tx(orderedIds)
  return listGameImages(gameId)
}

export function getGameImage(gameId: number, imageId: number): GameImage | null {
  return listGameImages(gameId).find((image) => image.id === imageId) ?? null
}

/** Deleting the applied thumbnail leaves the game without one. */
export function deleteGameImage(gameId: number, imageId: number): GameImage[] {
  const image = getGameImage(gameId, imageId)
  db.prepare('DELETE FROM game_images WHERE id = ? AND game_id = ?').run(imageId, gameId)
  if (image) {
    db.prepare('UPDATE games SET thumbnail_path = NULL WHERE id = ? AND thumbnail_path = ?').run(
      gameId,
      image.filePath
    )
  }
  return listGameImages(gameId)
}

/* ------------------------------------------------------------- routes ---- */

/* Every game has at least the line it opens on, before it forks. A game
   registered before routes existed has none, so the first read of its list is
   what gives it one — the same colour, no play time and not cleared. */
const COMMON_ROUTE_NAME = '共通'
const COMMON_ROUTE_COLOR = '#73bbc9'

function rowToRoute(row: {
  id: number
  game_id: number
  name: string
  color: string
  play_seconds: number
  cleared: number
  cleared_at: string | null
  clear_play_seconds: number | null
  is_active: number
  sort_order: number
  created_at: string
}): Route {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    color: row.color,
    playSeconds: row.play_seconds,
    cleared: row.cleared === 1,
    clearedAt: row.cleared_at,
    clearPlaySeconds: row.clear_play_seconds,
    isActive: row.is_active === 1,
    createdAt: row.created_at
  }
}

/** Oldest first, so the common route stays at the head of the list. */
export function listRoutes(gameId: number): Route[] {
  const read = (): Route[] =>
    (
      db
        .prepare('SELECT * FROM routes WHERE game_id = ? ORDER BY sort_order ASC, id ASC')
        .all(gameId) as Parameters<typeof rowToRoute>[0][]
    ).map(rowToRoute)

  let routes = read()
  if (routes.length === 0) {
    // Nothing is active to begin with: a game opens on the stepper's
    // "記録しない", and the common route is there to be stepped onto.
    db.prepare(
      `INSERT INTO routes (game_id, name, color, is_active, sort_order)
       VALUES (?, ?, ?, 0, 0)`
    ).run(gameId, COMMON_ROUTE_NAME, COMMON_ROUTE_COLOR)
    routes = read()
  }
  // Nothing active is a state of its own — the Active Route stepper's "記録し
  // ない" — so it is left alone rather than repaired.
  return routes
}

export function addRoute(input: NewRouteInput): Route[] {
  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM routes WHERE game_id = ?')
    .get(input.gameId) as { m: number }
  const info = db
    .prepare(
      `INSERT INTO routes
         (game_id, name, color, play_seconds, cleared, cleared_at, clear_play_seconds, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.gameId,
      input.name,
      input.color,
      input.playSeconds,
      input.cleared ? 1 : 0,
      // A route registered as already cleared is cleared as of now.
      input.cleared ? new Date().toISOString() : null,
      input.cleared ? input.playSeconds : null,
      next.m + 1
    )
  // A route just added is the one being played from here on.
  setActiveRoute(input.gameId, Number(info.lastInsertRowid))
  return listRoutes(input.gameId)
}

export function updateRoute(gameId: number, routeId: number, patch: RoutePatch): Route[] {
  const before = listRoutes(gameId).find((route) => route.id === routeId)
  // The Play log dates the clear, so the stamp is written on the crossing and
  // taken away again if the box is unticked. An already-cleared route keeps the
  // day it was cleared on.
  let clearedAt = before?.clearedAt ?? null
  let clearPlaySeconds = before?.clearPlaySeconds ?? null
  if (patch.cleared && !before?.cleared) {
    clearedAt = new Date().toISOString()
    clearPlaySeconds = patch.playSeconds
  } else if (!patch.cleared) {
    clearedAt = null
    clearPlaySeconds = null
  }
  db.prepare(
    `UPDATE routes SET name = ?, color = ?, play_seconds = ?, cleared = ?,
                       cleared_at = ?, clear_play_seconds = ?
     WHERE id = ? AND game_id = ?`
  ).run(
    patch.name,
    patch.color,
    patch.playSeconds,
    patch.cleared ? 1 : 0,
    clearedAt,
    clearPlaySeconds,
    routeId,
    gameId
  )
  return listRoutes(gameId)
}

/** The list never comes back empty: deleting the last one seeds a fresh common
    route, the way a game that never had one gets its first. */
export function deleteRoute(gameId: number, routeId: number): Route[] {
  const wasActive = listRoutes(gameId).some((route) => route.id === routeId && route.isActive)
  db.prepare('DELETE FROM routes WHERE id = ? AND game_id = ?').run(routeId, gameId)
  const remaining = listRoutes(gameId)
  // Deleting the route being played falls to the head of the list rather than
  // silently turning recording off.
  if (wasActive && remaining.length > 0 && !remaining.some((route) => route.isActive)) {
    return setActiveRoute(gameId, remaining[0].id)
  }
  return remaining
}

/** `null` leaves the game with no active route: nothing is recorded onto one. */
export function setActiveRoute(gameId: number, routeId: number | null): Route[] {
  const tx = db.transaction(() => {
    db.prepare('UPDATE routes SET is_active = 0 WHERE game_id = ?').run(gameId)
    if (routeId !== null) {
      db.prepare('UPDATE routes SET is_active = 1 WHERE id = ? AND game_id = ?').run(
        routeId,
        gameId
      )
    }
  })
  tx()
  return listRoutes(gameId)
}

/**
 * Banks a finished session on whichever route was active while it ran. Called
 * from the main process as the session ends, so the time lands whether or not
 * the Route board happens to be open.
 */
export function addRoutePlaySeconds(gameId: number, seconds: number): void {
  if (seconds <= 0) return
  // Seeds the common route if this game has never had one. Nothing active is
  // the stepper's "記録しない", so the session's time is simply not banked.
  const active = listRoutes(gameId).find((route) => route.isActive)
  if (!active) return
  db.prepare('UPDATE routes SET play_seconds = play_seconds + ? WHERE id = ?').run(
    seconds,
    active.id
  )
}

/* ------------------------------------------------------------- groups ---- */

/* A game's group has always been free text in `games.group_name`; the group
   list is new. Anything already typed into that field is therefore adopted on
   the first read, in the app's own quiet slate — a group made through New Group
   Setting carries whatever colour was picked for it there. */
const ADOPTED_GROUP_COLOR = '#aab8c2'

function rowToGroup(row: { id: number; name: string; color: string; created_at: string }): Group {
  return { id: row.id, name: row.name, color: row.color, createdAt: row.created_at }
}

/** Oldest first, so a list keeps the order the groups were made in. */
export function listGroups(): Group[] {
  db.exec(`
    INSERT INTO groups (name, color)
    SELECT DISTINCT TRIM(group_name), '${ADOPTED_GROUP_COLOR}' FROM games
    WHERE TRIM(COALESCE(group_name, '')) <> ''
      AND NOT EXISTS (SELECT 1 FROM groups WHERE groups.name = TRIM(games.group_name))
  `)
  return (
    db.prepare('SELECT * FROM groups ORDER BY id ASC').all() as Parameters<typeof rowToGroup>[0][]
  ).map(rowToGroup)
}

/** A name already on the list keeps its place and takes the new colour. */
export function addGroup(input: NewGroupInput): Group[] {
  db.prepare(
    `INSERT INTO groups (name, color) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET color = excluded.color`
  ).run(input.name.trim(), input.color)
  return listGroups()
}

/**
 * Renames a group and recolours it.
 *
 * **The games are renamed with it.** A game carries its group by *name*
 * (`games.group_name` is free text and always was), so a row renamed on its own
 * would leave every game under the old name — and `listGroups` would then adopt
 * that name straight back into the list as a group of its own. The rename is
 * the pair, in one transaction.
 */
export function updateGroup(id: number, input: NewGroupInput): Group[] {
  const before = db.prepare('SELECT name FROM groups WHERE id = ?').get(id) as
    | { name: string }
    | undefined
  if (!before) return listGroups()
  const name = input.name.trim()
  if (!name) return listGroups()

  const tx = db.transaction(() => {
    db.prepare('UPDATE groups SET name = ?, color = ? WHERE id = ?').run(name, input.color, id)
    if (name !== before.name) {
      db.prepare('UPDATE games SET group_name = ? WHERE TRIM(group_name) = ?').run(
        name,
        before.name
      )
    }
  })
  tx()
  return listGroups()
}

/* ---- Voices ---------------------------------------------------------- */

function rowToVoiceCharacter(row: { id: number; name: string; created_at: string }): VoiceCharacter {
  return { id: row.id, name: row.name, createdAt: row.created_at }
}

/** Oldest first, the way the groups are listed. */
export function listVoiceCharacters(): VoiceCharacter[] {
  return (
    db.prepare('SELECT * FROM voice_characters ORDER BY id ASC').all() as Parameters<
      typeof rowToVoiceCharacter
    >[0][]
  ).map(rowToVoiceCharacter)
}

/** A name already on the list is that row rather than a second one. */
export function addVoiceCharacter(name: string): VoiceCharacter[] {
  const trimmed = name.trim()
  if (trimmed) {
    db.prepare('INSERT INTO voice_characters (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(
      trimmed
    )
  }
  return listVoiceCharacters()
}

/** Renamed to a name another row already has, the two are merged: the voices
    under this one move to the other and this row goes. */
export function renameVoiceCharacter(id: number, name: string): VoiceCharacter[] {
  const trimmed = name.trim()
  if (!trimmed) return listVoiceCharacters()
  const other = db
    .prepare('SELECT id FROM voice_characters WHERE name = ? AND id <> ?')
    .get(trimmed, id) as { id: number } | undefined
  const tx = db.transaction(() => {
    if (other) {
      db.prepare('UPDATE voices SET character_id = ? WHERE character_id = ?').run(other.id, id)
      db.prepare('DELETE FROM voice_characters WHERE id = ?').run(id)
    } else {
      db.prepare('UPDATE voice_characters SET name = ? WHERE id = ?').run(trimmed, id)
    }
  })
  tx()
  return listVoiceCharacters()
}

/** The voices filed under it are left with no character (ON DELETE SET NULL). */
export function deleteVoiceCharacter(id: number): VoiceCharacter[] {
  db.prepare('DELETE FROM voice_characters WHERE id = ?').run(id)
  return listVoiceCharacters()
}

function rowToVoice(row: {
  id: number
  game_id: number | null
  character_id: number | null
  title: string
  file_path: string
  source_path: string | null
  created_at: string
}): Voice {
  return {
    id: row.id,
    gameId: row.game_id,
    characterId: row.character_id,
    title: row.title,
    filePath: row.file_path,
    sourcePath: row.source_path,
    createdAt: row.created_at
  }
}

/** Newest last, so the container fills in the order the voices were added. */
export function listVoices(): Voice[] {
  return (
    db.prepare('SELECT * FROM voices ORDER BY id ASC').all() as Parameters<typeof rowToVoice>[0][]
  ).map(rowToVoice)
}

export function getVoice(id: number): Voice | null {
  const row = db.prepare('SELECT * FROM voices WHERE id = ?').get(id) as
    | Parameters<typeof rowToVoice>[0]
    | undefined
  return row ? rowToVoice(row) : null
}

export function updateVoice(
  id: number,
  patch: VoicePatch & { filePath?: string }
): Voice[] {
  db.prepare(
    `UPDATE voices SET game_id = ?, character_id = ?, title = ?,
       file_path = COALESCE(?, file_path), source_path = COALESCE(?, source_path)
     WHERE id = ?`
  ).run(
    patch.gameId,
    patch.characterId,
    patch.title.trim(),
    patch.filePath ?? null,
    patch.sourcePath ?? null,
    id
  )
  return listVoices()
}

export function deleteVoice(id: number): Voice[] {
  db.prepare('DELETE FROM voices WHERE id = ?').run(id)
  return listVoices()
}

/* ---- Ledger ---------------------------------------------------------- */

function rowToLedgerEntry(row: {
  id: number
  game_id: number | null
  kind: string
  price: number
  date: string
  created_at: string
}): LedgerEntry {
  return {
    id: row.id,
    gameId: row.game_id,
    kind: row.kind === 'sell' ? 'sell' : 'buy',
    price: row.price,
    date: row.date,
    createdAt: row.created_at
  }
}

/** Newest date first, then newest row — the order the Right list and the
    pie read them in does not matter, but a stable one keeps tests simple. */
export function listLedgerEntries(): LedgerEntry[] {
  return (
    db
      .prepare('SELECT * FROM ledger_entries ORDER BY date DESC, id DESC')
      .all() as Parameters<typeof rowToLedgerEntry>[0][]
  ).map(rowToLedgerEntry)
}

/**
 * Writes a ledger entry, **overwriting the one already on that game, of that
 * kind, on that day** rather than adding a second: an edit to a day's figure
 * is the same day rewritten, and a new day is a new row. `game_id IS ?` is
 * null-safe, so a row with no game is matched the same way.
 */
export function addLedgerEntry(input: NewLedgerEntryInput): LedgerEntry[] {
  const kind = input.kind === 'sell' ? 'sell' : 'buy'
  const existing = db
    .prepare('SELECT id FROM ledger_entries WHERE game_id IS ? AND kind = ? AND date = ?')
    .get(input.gameId, kind, input.date) as { id: number } | undefined
  if (existing) {
    db.prepare('UPDATE ledger_entries SET price = ? WHERE id = ?').run(input.price, existing.id)
  } else {
    db.prepare('INSERT INTO ledger_entries (game_id, kind, price, date) VALUES (?, ?, ?, ?)').run(
      input.gameId,
      kind,
      input.price,
      input.date
    )
  }
  return listLedgerEntries()
}

export function deleteLedgerEntry(id: number): LedgerEntry[] {
  db.prepare('DELETE FROM ledger_entries WHERE id = ?').run(id)
  return listLedgerEntries()
}

export function addVoice(
  input: Omit<NewVoiceInput, 'sourcePath'> & { filePath: string; sourcePath: string }
): Voice[] {
  db.prepare(
    `INSERT INTO voices (game_id, character_id, title, file_path, source_path)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.gameId, input.characterId, input.title.trim(), input.filePath, input.sourcePath)
  return listVoices()
}

/**
 * Takes a group off the list, and off the games that were filed under it.
 *
 * **Both halves are the delete.** The row alone is not what a game reads — the
 * name on the game is — so a row deleted on its own leaves every game still
 * saying it is in that group, and `listGroups` adopts the name back on the very
 * next read. The games are set to no group instead, which is what the list
 * showed the group *as*.
 */
export function deleteGroup(id: number): Group[] {
  const row = db.prepare('SELECT name FROM groups WHERE id = ?').get(id) as
    | { name: string }
    | undefined
  if (!row) return listGroups()
  const tx = db.transaction(() => {
    db.prepare('UPDATE games SET group_name = NULL WHERE TRIM(group_name) = ?').run(row.name)
    db.prepare('DELETE FROM groups WHERE id = ?').run(id)
  })
  tx()
  return listGroups()
}

/* --------------------------------------------------------------- tags ---- */

/* One flat vocabulary of names. Nothing outside this file writes it: a tag
   comes into being when a game is filed under it and goes when the last game
   stops being (`setGameTags` below). The side panel's Add Tag chips are a
   filter over the list rather than rows here, so taking one off the row cannot
   take a tag off a game — which is what an `addTag`/`deleteTag` pair reachable
   from that row did, `game_tags` being ON DELETE CASCADE. */

function rowToTag(row: { id: number; name: string; created_at: string }): Tag {
  return { id: row.id, name: row.name, createdAt: row.created_at }
}

/** Oldest first, so the row stays where it was put. */
/* The Setting board's rows. They are the app's own rather than a game's, so
   they are one flat key/value table read as a whole: a row that has never been
   written falls back to the default, and a row holding a value this build does
   not know falls back to it too rather than putting an unreadable setting on
   the board. */
const DEFAULT_SETTINGS: AppSettings = {
  // The app is written in Japanese, so that is what it opens in.
  language: 'ja',
  // The release the reference row has always read: the first complete English
  // one, which is what `parseVndb` looked for before there was a row to ask.
  vndbReleaseLanguage: 'en',
  // What each of the three captures is written as today, so an install that
  // predates these rows keeps making exactly the files it already made.
  screenshotFormat: 'png',
  videoFormat: 'mp4',
  audioFormat: 'mp3',
  // The face the design draws; the other one is the toggle's to ask for.
  homeLayout: 'grid',
  // And the five cards a row the design draws, the other two being what the
  // same button asks for once that face is the one that is on.
  homeColumns: '5',
  // And the 25 spines across the design's Bookshelf Container.
  homeSpines: '25',
  // Nothing confirmed: the row stands for whatever today's plans are.
  noticeSeen: '',
  // Penpot writes THIS WEEK into the Period Setting field, so that is the
  // period the graph opens on until SET DEFAULT is pressed on another row.
  graphPeriod: 'this-week',
  // Where the panel has always opened: the bottom right of the primary
  // display's work area.
  overlayCorner: 'bottom-right',
  overlayDisplay: 'primary',
  // The app's arrivals are what it already does, so they stay on.
  animations: 'on',
  // On: the frame is how a glance down the side panel says a game's group.
  groupFrame: 'on',
  // Off, so an install that predates this row keeps writing a screenshot to
  // one place only — the file it is offered to save.
  screenshotToGallery: 'off',
  // The same for a recording, and off for the same reason.
  videoToGallery: 'off',
  // The same for an audio recording, filed in the Voice Manager; off so an
  // install that predates it keeps writing the recording to one place only.
  audioToVoice: 'off',
  // The design's own size; the other two are the player's to ask for.
  overlaySize: 'medium',
  rememberPanelPosition: 'on',
  // Both sounds are already made, so the rows that turn them off start on.
  crackerSound: 'on',
  balloonSound: 'on',
  // The panel has never made a sound of its own, so it goes on not making one
  // until a number is picked.
  screenshotSound: 'off',
  videoSound: 'off',
  audioSound: 'off',
  // Full volume until the bar is moved.
  voiceVolume: 1,
  // On: opening the Voice Manager searches by the game that was open, which is
  // what it has always done.
  voiceInitialSearch: 'on',
  // Nothing about the machine is touched until the row is turned on.
  launchAtLogin: 'off',
  // The Add Game dialog is the design's own board alone until the advanced
  // panel is asked for.
  addGameMore: 'off',
  // Not yet seen, so a fresh library gets the coach-mark over the note icon.
  guideSeen: 'off',
  // The window the app has always opened at, and no backup until one is asked
  // for and told where to go.
  launchWindowMode: 'window',
  // 叛逆明朝, the app's own Japanese face.
  jpFont: 'hangyaku',
  // Chromium's own defaults, which is what every install has always run on.
  gpuMode: 'auto',
  backupOnLaunch: 'off',
  backupDirectory: '',
  backupRestorePath: '',
  // Nothing saved yet, so each dialog opens where it always did.
  lastSaveScreenshot: '',
  lastSaveVideo: '',
  lastSaveAudio: '',
  // No game remembered yet, so the first launch opens on the first listed game.
  lastOpenGameId: ''
}

/** A stored value only counts if this build knows it; anything else is the
    default, which is what keeps a setting written by a later build off the
    board rather than putting an unreadable value on it. */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** A stored effect sound: `off`, or the number a file in `recorderpanel_SE`
    is named for. */
function soundKey(value: string | undefined): string {
  return value && /^\d{1,3}$/.test(value) ? value : 'off'
}

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  return {
    language: oneOf(stored.get('language'), ['ja', 'en'], DEFAULT_SETTINGS.language),
    vndbReleaseLanguage: oneOf(
      stored.get('vndbReleaseLanguage'),
      VNDB_RELEASE_LANGUAGES,
      DEFAULT_SETTINGS.vndbReleaseLanguage
    ),
    screenshotFormat: oneOf(
      stored.get('screenshotFormat'),
      ['png', 'jpg'],
      DEFAULT_SETTINGS.screenshotFormat
    ),
    videoFormat: oneOf(stored.get('videoFormat'), ['mp4', 'mov'], DEFAULT_SETTINGS.videoFormat),
    audioFormat: oneOf(stored.get('audioFormat'), ['mp3', 'wav'], DEFAULT_SETTINGS.audioFormat),
    homeLayout: oneOf(stored.get('homeLayout'), ['grid', 'shelf'], DEFAULT_SETTINGS.homeLayout),
    homeColumns: oneOf(stored.get('homeColumns'), HOME_COLUMNS, DEFAULT_SETTINGS.homeColumns),
    homeSpines: oneOf(stored.get('homeSpines'), HOME_SPINES, DEFAULT_SETTINGS.homeSpines),
    /* A day rather than a value out of a list, like `overlayDisplay`: anything
       that is not a local date key is nothing confirmed. */
    noticeSeen: /^\d{4}-\d{2}-\d{2}$/.test(stored.get('noticeSeen') ?? '')
      ? (stored.get('noticeSeen') as string)
      : DEFAULT_SETTINGS.noticeSeen,
    graphPeriod: oneOf(stored.get('graphPeriod'), GRAPH_PERIODS, DEFAULT_SETTINGS.graphPeriod),
    overlayCorner: oneOf(
      stored.get('overlayCorner'),
      OVERLAY_CORNERS,
      DEFAULT_SETTINGS.overlayCorner
    ),
    /* The one setting whose values are not a list this build knows: a display
       id is whatever the system gives it. Anything that is not a run of
       digits is the primary display, which is also what an id that is no
       longer on the desktop comes to when the panel is placed. */
    overlayDisplay: /^\d+$/.test(stored.get('overlayDisplay') ?? '')
      ? (stored.get('overlayDisplay') as string)
      : DEFAULT_SETTINGS.overlayDisplay,
    animations: oneOf(stored.get('animations'), ['on', 'off'], DEFAULT_SETTINGS.animations),
    screenshotToGallery: oneOf(
      stored.get('screenshotToGallery'),
      ['on', 'off'],
      DEFAULT_SETTINGS.screenshotToGallery
    ),
    videoToGallery: oneOf(
      stored.get('videoToGallery'),
      ['on', 'off'],
      DEFAULT_SETTINGS.videoToGallery
    ),
    audioToVoice: oneOf(stored.get('audioToVoice'), ['on', 'off'], DEFAULT_SETTINGS.audioToVoice),
    groupFrame: oneOf(stored.get('groupFrame'), ['on', 'off'], DEFAULT_SETTINGS.groupFrame),
    overlaySize: oneOf(stored.get('overlaySize'), OVERLAY_SIZES, DEFAULT_SETTINGS.overlaySize),
    rememberPanelPosition: oneOf(
      stored.get('rememberPanelPosition'),
      ['on', 'off'],
      DEFAULT_SETTINGS.rememberPanelPosition
    ),
    crackerSound: oneOf(stored.get('crackerSound'), ['on', 'off'], DEFAULT_SETTINGS.crackerSound),
    balloonSound: oneOf(stored.get('balloonSound'), ['on', 'off'], DEFAULT_SETTINGS.balloonSound),
    /* Like `overlayDisplay`, these two hold a value that is not a list this
       build knows: a sound is named by the number its file begins with, and
       the folder is what says which numbers there are. Anything that is not
       `off` or a run of digits is `off`; a number with no file behind it is
       caught where the file is looked up (`soundEffectFile`). */
    voiceVolume: (() => {
      const value = Number(stored.get('voiceVolume'))
      return Number.isFinite(value) && value >= 0 && value <= 1
        ? value
        : DEFAULT_SETTINGS.voiceVolume
    })(),
    voiceInitialSearch: oneOf(
      stored.get('voiceInitialSearch'),
      ['on', 'off'],
      DEFAULT_SETTINGS.voiceInitialSearch
    ),
    screenshotSound: soundKey(stored.get('screenshotSound')),
    /* `recordingSound` was the one row these two came out of. It is read as
       the fallback for both so an install that chose a sound before the split
       keeps it, on the screen recording and on the audio alike. */
    videoSound: soundKey(stored.get('videoSound') ?? stored.get('recordingSound')),
    audioSound: soundKey(stored.get('audioSound') ?? stored.get('recordingSound')),
    launchAtLogin: oneOf(stored.get('launchAtLogin'), ['on', 'off'], DEFAULT_SETTINGS.launchAtLogin),
    addGameMore: oneOf(stored.get('addGameMore'), ['on', 'off'], DEFAULT_SETTINGS.addGameMore),
    guideSeen: oneOf(stored.get('guideSeen'), ['on', 'off'], DEFAULT_SETTINGS.guideSeen),
    gpuMode: oneOf(stored.get('gpuMode'), GPU_MODES, DEFAULT_SETTINGS.gpuMode),
    launchWindowMode: oneOf(
      stored.get('launchWindowMode'),
      ['window', 'fullscreen'],
      DEFAULT_SETTINGS.launchWindowMode
    ),
    jpFont: oneOf(
      stored.get('jpFont'),
      ['hangyaku', 'kinkakuji', 'kurohana'],
      DEFAULT_SETTINGS.jpFont
    ),
    backupOnLaunch: oneOf(
      stored.get('backupOnLaunch'),
      ['on', 'off'],
      DEFAULT_SETTINGS.backupOnLaunch
    ),
    /* A path is whatever the player named, so there is nothing to check it
       against here; what it comes to is checked where it is written to. */
    backupDirectory: stored.get('backupDirectory') ?? DEFAULT_SETTINGS.backupDirectory,
    backupRestorePath: stored.get('backupRestorePath') ?? DEFAULT_SETTINGS.backupRestorePath,
    lastSaveScreenshot: stored.get('lastSaveScreenshot') ?? DEFAULT_SETTINGS.lastSaveScreenshot,
    lastSaveVideo: stored.get('lastSaveVideo') ?? DEFAULT_SETTINGS.lastSaveVideo,
    lastSaveAudio: stored.get('lastSaveAudio') ?? DEFAULT_SETTINGS.lastSaveAudio,
    lastOpenGameId: stored.get('lastOpenGameId') ?? DEFAULT_SETTINGS.lastOpenGameId
  }
}

/** Writes the keys the patch names and answers with the whole of the settings. */
export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const write = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  const apply = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) write.run(key, value)
  })
  apply(
    Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)] as [string, string])
  )
  return getSettings()
}

export function listTags(): Tag[] {
  return (
    db.prepare('SELECT * FROM tags ORDER BY id ASC').all() as Parameters<typeof rowToTag>[0][]
  ).map(rowToTag)
}

/**
 * What the Add Game dialog's Tag row writes: the game's tags, by name.
 *
 * A tag is one name in a vocabulary the whole library shares — the side
 * panel's row reads the same table — so a name already in it is reused and
 * only a new one puts out a row. The list replaces whatever the game had, and
 * a blank name is a chip still being written rather than a tag.
 */
export function setGameTags(gameId: number, names: string[]): void {
  const find = db.prepare('SELECT id FROM tags WHERE name = ? ORDER BY id ASC LIMIT 1')
  const insert = db.prepare('INSERT INTO tags (name) VALUES (?)')
  const link = db.prepare('INSERT OR IGNORE INTO game_tags (game_id, tag_id) VALUES (?, ?)')
  const tx = db.transaction((list: string[]) => {
    db.prepare('DELETE FROM game_tags WHERE game_id = ?').run(gameId)
    for (const raw of list) {
      const name = raw.trim()
      if (name === '') continue
      const found = find.get(name) as { id: number } | undefined
      const tagId = found ? found.id : (insert.run(name).lastInsertRowid as number)
      link.run(gameId, tagId)
    }
    /* A name nothing is filed under any more is not part of the vocabulary,
       and nothing else prunes it — this is the only writer. It also clears out
       the blanks the old Add Tag row left behind. */
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM game_tags)').run()
  })
  tx(names)
}

/**
 * What a Home cell's right-click menu writes: the picture that one face shows
 * for this game, or null to hand the cell back to the game's Main Image.
 *
 * Deliberately not `setThumbnail` and deliberately not a `game_images` row — a
 * picture given to a card is the card's, so nothing else in the app may pick
 * it up.
 */
export function setHomeImage(
  gameId: number,
  face: HomeLayout,
  filePath: string | null
): GameWithStats {
  const column = face === 'shelf' ? 'home_spine_image' : 'home_card_image'
  db.prepare(`UPDATE games SET ${column} = ? WHERE id = ?`).run(filePath, gameId)
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId)
  if (!row) throw new Error(t('ゲームが見つかりません (id={0})', gameId))
  return rowToGameWithStats(row)
}

export function setThumbnail(gameId: number, filePath: string | null): GameWithStats {
  db.prepare('UPDATE games SET thumbnail_path = ? WHERE id = ?').run(filePath, gameId)
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId)
  if (!row) throw new Error(t('ゲームが見つかりません (id={0})', gameId))
  return rowToGameWithStats(row)
}

/**
 * Sets what the Progress triangle reads. A score only belongs to a cleared
 * game, so anything else drops it.
 */
export function setProgress(
  gameId: number,
  state: ProgressState | null,
  score: number | null
): GameWithStats {
  const kept =
    state === 'cleared' && score !== null ? Math.min(100, Math.max(0, Math.round(score))) : null

  /* Clearing stamps the moment and what TOTAL PLAY stood at, which is what the
     Play log's GAME CLEARD row reads. Setting the game back to anything else
     takes the row away with it. Re-clearing an already cleared game keeps the
     first stamp: the score can be corrected without moving the event. */
  const before = getGame(gameId)
  const clearedAt = state === 'cleared' ? (before?.clearedAt ?? new Date().toISOString()) : null
  const clearPlaySeconds =
    state === 'cleared' ? (before?.clearPlaySeconds ?? before?.stats.totalPlaySeconds ?? 0) : null

  db.prepare(
    `UPDATE games
     SET progress_state = ?, clear_score = ?, cleared_at = ?, clear_play_seconds = ?
     WHERE id = ?`
  ).run(state, kept, clearedAt, clearPlaySeconds, gameId)

  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId)
  if (!row) throw new Error(t('ゲームが見つかりません (id={0})', gameId))
  return rowToGameWithStats(row)
}

/**
 * Takes one session off a game, which is what a row of the Play log is.
 *
 * Every total the app writes is `SUM(duration_seconds)` over this table — the
 * game's own, the footer's, the Calender board's days, the graph's period — so
 * the time goes with the row and nothing else has to be adjusted. The one
 * figure that does not follow it is a route's banked `play_seconds`: a session
 * is banked on whichever route was active and does not record which, so there
 * is nothing here to take it off.
 */
export function deleteSession(gameId: number, sessionId: number): void {
  db.prepare('DELETE FROM sessions WHERE id = ? AND game_id = ?').run(sessionId, gameId)
}

export function listGames(): GameWithStats[] {
  const rows = db.prepare('SELECT * FROM games ORDER BY sort_order ASC, id ASC').all()
  return rows.map(rowToGameWithStats)
}

export function addGame(input: NewGameInput): GameWithStats {
  const maxOrder = (
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM games').get() as { m: number }
  ).m
  const info = db
    .prepare(
      `INSERT INTO games (title, short_name, thumbnail_path, icon_path, exe_path, group_name,
                          use_exe_icon, use_short_name, use_thumbnail_default, sort_order,
                          release_date, release_language, median_score, average_score, brand,
                          purchase_date, purchase_price, list_price, reference_url)
       VALUES (@title, @shortName, @thumbnailPath, @iconPath, @exePath, @groupName,
               @useExeIcon, @useShortName, @useThumbnailAsDefault, @sortOrder,
               @releaseDate, @releaseLanguage, @medianScore, @averageScore, @brand,
               @purchaseDate, @purchasePrice, @listPrice, @referenceUrl)`
    )
    .run({
      title: input.title,
      shortName: input.shortName,
      thumbnailPath: input.thumbnailPath,
      iconPath: input.iconPath,
      exePath: input.exePath,
      groupName: input.groupName,
      useExeIcon: input.useExeIcon ? 1 : 0,
      useShortName: input.useShortName ? 1 : 0,
      useThumbnailAsDefault: input.useThumbnailAsDefault ? 1 : 0,
      sortOrder: maxOrder + 1,
      releaseDate: input.releaseDate ?? null,
      releaseLanguage: input.releaseLanguage ?? null,
      medianScore: input.medianScore ?? null,
      averageScore: input.averageScore ?? null,
      brand: input.brand ?? null,
      purchaseDate: input.purchaseDate ?? null,
      purchasePrice: input.purchasePrice ?? null,
      listPrice: input.listPrice ?? null,
      referenceUrl: input.referenceUrl ?? null
    })

  linkThumbnail(info.lastInsertRowid as number, input.thumbnailPath)
  setGameTags(info.lastInsertRowid as number, input.tagNames ?? [])

  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(info.lastInsertRowid)
  return rowToGameWithStats(row)
}

export function updateGame(gameId: number, input: NewGameInput): GameWithStats {
  db.prepare(
    `UPDATE games SET
       title = @title,
       short_name = @shortName,
       thumbnail_path = @thumbnailPath,
       icon_path = @iconPath,
       exe_path = @exePath,
       group_name = @groupName,
       use_exe_icon = @useExeIcon,
       use_short_name = @useShortName,
       use_thumbnail_default = @useThumbnailAsDefault,
       /* **The panel's own fields are written as they stand**: the dialog
          opens them from the game, so what comes back is what the game had
          unless it was edited — which is what lets the advanced panel change
          or clear a brand or a release date. */
       release_date = @releaseDate,
       brand = @brand,
       /* **The rest are only written where the Reference row was pressed.** A
          game edited without touching that row keeps whatever it was
          registered with — the release language, the median and the average
          are the row's alone, and it hands back null for them otherwise. */
       release_language = COALESCE(@releaseLanguage, release_language),
       median_score = COALESCE(@medianScore, median_score),
       average_score = COALESCE(@averageScore, average_score),
       /* Written as they stand, the way the URL is: the advanced panel's own
          fields, so what they say is what the game carries. */
       purchase_date = @purchaseDate,
       purchase_price = @purchasePrice,
       list_price = @listPrice,
       /* Not coalesced: the URL is the Reference row's own field rather than
          something it read, so what the field says is what the game carries —
          emptied, the game has none and the Game Info board's mark becomes the
          gear that opens this dialog again. */
       reference_url = @referenceUrl
     WHERE id = @gameId`
  ).run({
    gameId,
    title: input.title,
    shortName: input.shortName,
    thumbnailPath: input.thumbnailPath,
    iconPath: input.iconPath,
    exePath: input.exePath,
    groupName: input.groupName,
    useExeIcon: input.useExeIcon ? 1 : 0,
    useShortName: input.useShortName ? 1 : 0,
    useThumbnailAsDefault: input.useThumbnailAsDefault ? 1 : 0,
    releaseDate: input.releaseDate ?? null,
    releaseLanguage: input.releaseLanguage ?? null,
    medianScore: input.medianScore ?? null,
    averageScore: input.averageScore ?? null,
    brand: input.brand ?? null,
    purchaseDate: input.purchaseDate ?? null,
    purchasePrice: input.purchasePrice ?? null,
    listPrice: input.listPrice ?? null,
    referenceUrl: input.referenceUrl ?? null
  })

  linkThumbnail(gameId, input.thumbnailPath)
  setGameTags(gameId, input.tagNames ?? [])

  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId)
  if (!row) throw new Error(t('ゲームが見つかりません (id={0})', gameId))
  return rowToGameWithStats(row)
}

/**
 * The four values the Game Info board draws, written as the board's own gear
 * left them.
 *
 * Not `updateGame`: that one takes the whole of what the Add Game dialog holds,
 * and this is four fields on a board that knows nothing about the rest of the
 * game. Written plainly rather than coalesced — the board is where these are
 * typed, so an emptied field means the game has no such value, which is what
 * the board then draws as "--".
 */
export function setGameReference(gameId: number, input: GameReference): GameWithStats {
  db.prepare(
    `UPDATE games SET
       brand = @brand,
       release_date = @releaseDate,
       /* **A date typed here is nobody's release but this game's.** The mark
          beside it says which of the VN Database's per-language releases the
          date came from, and one written by hand came from none of them. */
       release_language = NULL,
       median_score = @medianScore,
       average_score = @averageScore
     WHERE id = @gameId`
  ).run({
    gameId,
    brand: input.brand,
    releaseDate: input.releaseDate,
    medianScore: input.medianScore,
    averageScore: input.averageScore
  })

  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId)
  if (!row) throw new Error(t('ゲームが見つかりません (id={0})', gameId))
  return rowToGameWithStats(row)
}

export function deleteGame(gameId: number): void {
  db.prepare('DELETE FROM games WHERE id = ?').run(gameId)
}

export function reorderGames(orderedIds: number[]): void {
  const update = db.prepare('UPDATE games SET sort_order = ? WHERE id = ?')
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => update.run(index, id))
  })
  tx(orderedIds)
}

export function getGame(gameId: number): GameWithStats | null {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId)
  return row ? rowToGameWithStats(row) : null
}

/** Where the Recorder Panel was last left for a game — the corner it folds and
    grows from, in screen pixels — or null if it has never been moved for it. */
export function getPanelPosition(gameId: number): { x: number; y: number } | null {
  const row = db.prepare('SELECT panel_x, panel_y FROM games WHERE id = ?').get(gameId) as
    | { panel_x: number | null; panel_y: number | null }
    | undefined
  if (!row || row.panel_x === null || row.panel_y === null) return null
  return { x: row.panel_x, y: row.panel_y }
}

/** Remembers where the panel was left for a game, written as its play ends. */
export function setPanelPosition(gameId: number, x: number, y: number): void {
  db.prepare('UPDATE games SET panel_x = ?, panel_y = ? WHERE id = ?').run(
    Math.round(x),
    Math.round(y),
    gameId
  )
}

export function getLaunchPrefs(gameId: number): LaunchPrefs {
  const row = db.prepare('SELECT * FROM launch_prefs WHERE game_id = ?').get(gameId) as
    | {
        game_id: number
        record_time: number
        use_recorder_panel: number
        run_as_admin: number
      }
    | undefined

  if (!row) {
    return {
      gameId,
      recordTime: true,
      useRecorderPanel: true,
      runAsAdmin: false,
      keepSetting: false
    }
  }
  return {
    gameId: row.game_id,
    recordTime: !!row.record_time,
    useRecorderPanel: !!row.use_recorder_panel,
    runAsAdmin: !!row.run_as_admin,
    // "Keep This Setting" is a one-shot instruction, so it always starts clear.
    keepSetting: false
  }
}

export function setLaunchPrefs(prefs: LaunchPrefs): void {
  if (prefs.gameId === null) return
  db.prepare(
    `INSERT INTO launch_prefs (game_id, record_time, use_recorder_panel, run_as_admin, keep_setting)
     VALUES (@gameId, @recordTime, @useRecorderPanel, @runAsAdmin, 0)
     ON CONFLICT(game_id) DO UPDATE SET
       record_time = excluded.record_time,
       use_recorder_panel = excluded.use_recorder_panel,
       run_as_admin = excluded.run_as_admin,
       keep_setting = 0`
  ).run({
    gameId: prefs.gameId,
    recordTime: prefs.recordTime ? 1 : 0,
    useRecorderPanel: prefs.useRecorderPanel ? 1 : 0,
    runAsAdmin: prefs.runAsAdmin ? 1 : 0
  })
}

/**
 * Every session the game has, newest first — the Play Log reads these. A
 * session that is still running has no `endedAt`, so the log can leave it out.
 */
export function listSessions(gameId: number): Session[] {
  /* A session standing for a hand edit is left out: the log draws the edit
     itself, and a PLAYED row beside it would say the game was opened. */
  const rows = db
    .prepare(
      `SELECT * FROM sessions WHERE game_id = ? AND id NOT IN ${ADJUSTMENT_SESSIONS}
       ORDER BY started_at DESC, id DESC`
    )
    .all(gameId) as {
    id: number
    game_id: number
    started_at: string
    ended_at: string | null
    duration_seconds: number
    recorded: number
  }[]

  return rows.map((row) => ({
    id: row.id,
    gameId: row.game_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    recorded: !!row.recorded
  }))
}

export function startSession(gameId: number, recorded: boolean): Session {
  const startedAt = new Date().toISOString()
  const info = db
    .prepare(
      'INSERT INTO sessions (game_id, started_at, duration_seconds, recorded) VALUES (?, ?, 0, ?)'
    )
    .run(gameId, startedAt, recorded ? 1 : 0)

  return {
    id: info.lastInsertRowid as number,
    gameId,
    startedAt,
    endedAt: null,
    durationSeconds: 0,
    recorded
  }
}

/**
 * `durationSeconds` is the Recorder Panel's elapsed time rather than the wall
 * clock, so spans the player paused never reach the play-time totals.
 */
export function endSession(sessionId: number, durationSeconds: number): Session {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as {
    id: number
    game_id: number
    started_at: string
    ended_at: string | null
    duration_seconds: number
    recorded: number
  }

  const endedAt = new Date().toISOString()

  db.prepare('UPDATE sessions SET ended_at = ?, duration_seconds = ? WHERE id = ?').run(
    endedAt,
    Math.max(0, Math.round(durationSeconds)),
    sessionId
  )

  return {
    id: row.id,
    gameId: row.game_id,
    startedAt: row.started_at,
    endedAt,
    durationSeconds: Math.max(0, Math.round(durationSeconds)),
    recorded: !!row.recorded
  }
}

export function getFooterStats(): FooterStats {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfDay)
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)

  const sumSince = (iso: string): number => {
    const result = db
      .prepare(
        `SELECT COALESCE(SUM(duration_seconds), 0) AS total
         FROM sessions WHERE started_at >= ? AND recorded = 1`
      )
      .get(iso) as { total: number }
    // Held at nothing: a hand subtraction is a session of negative length.
    return Math.max(0, result.total)
  }

  return {
    todaySeconds: sumSince(startOfDay.toISOString()),
    weekSeconds: sumSince(startOfWeek.toISOString()),
    monthSeconds: sumSince(startOfMonth.toISOString()),
    yearSeconds: sumSince(startOfYear.toISOString())
  }
}


/**
 * Recorded play time banked against each local day between the two given
 * dates, both inclusive and both written as a local "YYYY-MM-DD" — what the
 * Calender board's grid asks for, which is the 42 cells it draws rather than
 * the month alone.
 *
 * `sessions.started_at` is a UTC instant, so the two ends are turned into
 * local midnights before they are compared and the buckets are made from each
 * session's own local date. A session is banked on the day it *started*: one
 * played across midnight belongs to the evening it began, which is how the
 * player would describe it.
 */
export function getPlaytimeByDay(fromDate: string, toDate: string): DayPlaytime[] {
  // No `Z`, so both are read as local midnight; the end is the day after the
  // last one asked for.
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  to.setDate(to.getDate() + 1)

  const rows = db
    .prepare(
      `SELECT started_at, duration_seconds FROM sessions
       WHERE recorded = 1 AND duration_seconds <> 0 AND started_at >= ? AND started_at < ?`
    )
    .all(from.toISOString(), to.toISOString()) as {
    started_at: string
    duration_seconds: number
  }[]

  const totals = new Map<string, number>()
  for (const row of rows) {
    const at = new Date(row.started_at)
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
      at.getDate()
    ).padStart(2, '0')}`
    totals.set(key, (totals.get(key) ?? 0) + row.duration_seconds)
  }

  // A day taken under nothing by a hand subtraction is a day with nothing on it.
  return [...totals].filter(([, seconds]) => seconds > 0).map(([date, seconds]) => ({ date, seconds }))
}


/* The Calender board's plans. A plan belongs to a local calendar day rather
   than to an instant, so `date` is the same "YYYY-MM-DD" the day totals are
   keyed on and no timezone maths is needed to read one back. */

interface PlanRow {
  id: number
  date: string
  name: string
  description: string
  color: string
  notify: number
}

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    description: row.description,
    color: row.color,
    notify: !!row.notify
  }
}

/** Every plan between the two days, both inclusive — the 42 cells the grid
    draws ask for their own span in one read. Oldest first, and within a day in
    the order they were written. */
export function listPlans(fromDate: string, toDate: string): Plan[] {
  const rows = db
    .prepare('SELECT * FROM plans WHERE date >= ? AND date <= ? ORDER BY date, id')
    .all(fromDate, toDate) as PlanRow[]
  return rows.map(toPlan)
}

export function addPlan(input: NewPlanInput): Plan {
  const info = db
    .prepare(
      'INSERT INTO plans (date, name, description, color, notify) VALUES (?, ?, ?, ?, ?)'
    )
    .run(input.date, input.name, input.description, input.color, input.notify ? 1 : 0)
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(info.lastInsertRowid) as PlanRow
  return toPlan(row)
}

/** A plan written again from the editor the Plan Detail board opens. The day
    is written with it: the editor is opened on the day the panel is on, and
    that is the day the plan belongs to. */
export function updatePlan(planId: number, input: NewPlanInput): Plan {
  db.prepare(
    'UPDATE plans SET date = ?, name = ?, description = ?, color = ?, notify = ? WHERE id = ?'
  ).run(input.date, input.name, input.description, input.color, input.notify ? 1 : 0, planId)
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) as PlanRow
  return toPlan(row)
}

export function deletePlan(planId: number): void {
  db.prepare('DELETE FROM plans WHERE id = ?').run(planId)
}


/**
 * What each game was played for on each local day between the two given days,
 * both inclusive — the PlayTime Graph board's whole source. Its pie and its
 * game list add these up per game and its histogram per day, so the board
 * reads them once rather than asking two questions of the same sessions.
 *
 * Bucketed the way `getPlaytimeByDay` buckets: `sessions.started_at` is a UTC
 * instant, so the two ends are turned into local midnights before they are
 * compared and every session is banked on the local day it *started*.
 */
export function getPlaytimeByDayAndGame(fromDate: string, toDate: string): DayGamePlaytime[] {
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  to.setDate(to.getDate() + 1)

  const rows = db
    .prepare(
      `SELECT game_id, started_at, duration_seconds FROM sessions
       WHERE recorded = 1 AND duration_seconds <> 0 AND started_at >= ? AND started_at < ?`
    )
    .all(from.toISOString(), to.toISOString()) as {
    game_id: number
    started_at: string
    duration_seconds: number
  }[]

  const totals = new Map<string, DayGamePlaytime>()
  for (const row of rows) {
    const at = new Date(row.started_at)
    const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
      at.getDate()
    ).padStart(2, '0')}`
    const key = `${date}:${row.game_id}`
    const already = totals.get(key)
    if (already) already.seconds += row.duration_seconds
    else totals.set(key, { date, gameId: row.game_id, seconds: row.duration_seconds })
  }

  /* A game's own net for the day, negative included: a hand subtraction that
     takes time off a day is a row of that day the same as a session that adds
     it, so it is kept (shown with a minus) rather than dropped — which is what
     kept the per-game breakdown from adding up to the day's own total. Only an
     exact zero, which says nothing, is left off. */
  return [...totals.values()].filter((row) => row.seconds !== 0)
}

/*
 * **A backup is the database and the files it points at.** The rows carry
 * paths, and every one of those paths that the app itself made is under
 * `userData`: the gallery's own copies (`game-images`), the pictures a Home
 * cell was given (`home-images`), and the icon and thumbnail an added game was
 * filed with (`icons`, `images`). A backup of the database alone restores
 * every row and none of the pictures, which on the same machine is invisible —
 * the files never went anywhere — and on a *different* machine is a library of
 * empty frames. So these travel with it.
 *
 * What does not: `screenshots`, `videos` and `audio` are where a capture is
 * written before the save dialog moves it somewhere the player chose. Nothing
 * in the database points into them, and what is left there is a capture that
 * was thrown away.
 */
const BACKUP_MEDIA_DIRS = ['game-images', 'home-images', 'icons', 'images', 'voices']

/* What says a folder is one of this app's own backups rather than somewhere a
   `.sqlite3` happens to be. It is written beside the database, so a restore
   can tell a complete backup from a bare database file — which is what every
   backup made before this was — by looking next to what it was handed. */
const BACKUP_MANIFEST = 'from-visual-novel-backup.json'

/**
 * **The pictures are held once for the whole backup folder, not once per
 * backup.**
 *
 * Every backup used to carry its own copy of all four media folders, and the
 * copies were very nearly the same every time: measured on a real library, one
 * backup came to 106MB of which 100.5MB was `game-images`, and the tiers keep
 * about thirty of them — some 3.5GB of the same pictures written over and over.
 * Zipping answers none of that: those files are PNG and MP4, which are
 * compressed already (measured: the largest 40 of them, four fifths of the
 * gallery, came out of `Compress-Archive` at exactly their own size).
 *
 * So there is one `media/` beside the dated folders, and each dated folder
 * holds the database and a manifest saying **which of the pool's files it
 * needs and where each one goes back to**. Thirty backups then cost the pool
 * once and about 2MB apiece.
 *
 * **A pool entry is named for its contents** — the sha1 of the bytes, keeping
 * the file's own extension — rather than for where it came from. The app's own
 * copies are named with a UUID and never rewritten, so their names would nearly
 * have done; the exception is `icons`, whose file is named for the executable
 * it was pulled from (`GamesExtractExeIcon`) and *is* written again when that
 * executable's icon changes. Named for its bytes, a file that has changed is a
 * different entry and an old backup still restores what it actually had. Two
 * copies of the same picture also become one entry, whichever folders they are
 * in — measured on that same library, 2523 files came to 2510 entries and
 * 106.25MB came to 87.99MB, before a single second backup was taken. The first
 * two characters fan the pool out into 256 directories, so no one of them holds
 * thousands of files.
 */
const BACKUP_POOL = 'media'

/*
 * **How long a backup is kept depends on what it stands for.** Every launch
 * makes one and the folder would otherwise grow without end, so each is filed
 * as the day's, the week's, the month's or the year's, and each of those is
 * kept for a different length of time:
 *
 *   day    — a week
 *   week   — three months
 *   month  — a year
 *   year   — forever
 *
 * **Which one a backup is, is decided by what is not there yet.** The week's is
 * simply the first backup of that week, the month's the first of that month and
 * the year's the first of that year — so a Sunday the app was not opened on is
 * answered by the next day it *was*, and the same for a first of the month. A
 * backup that stands for the year stands for its month and its week as well,
 * which is why the test is by rank rather than by name.
 *
 * **And it is written into the folder's name** (`library-2026-09-07-week`), so
 * what a backup is kept for can be read off it without opening anything — and
 * so this can work it out again on the next launch from the folder alone.
 * A folder from before the tiers existed carries no tag and is read as a day's.
 */
type BackupTier = 'year' | 'month' | 'week' | 'day'
const TIER_RANK: Record<BackupTier, number> = { year: 3, month: 2, week: 1, day: 0 }
const BACKUP_NAME = /^library-(\d{4})-(\d{2})-(\d{2})(?:-(year|month|week|day))?$/

interface KeptBackup {
  name: string
  /** The local midnight of the day it was taken for. */
  date: Date
  tier: BackupTier
}

const midnight = (at: Date): Date => new Date(at.getFullYear(), at.getMonth(), at.getDate())

function daysBefore(at: Date, days: number): Date {
  const out = midnight(at)
  out.setDate(out.getDate() - days)
  return out
}

function monthsBefore(at: Date, months: number): Date {
  const out = midnight(at)
  out.setMonth(out.getMonth() - months)
  return out
}

/** The Sunday the given day's week begins on — `getDay()` is 0 there. */
function weekStart(at: Date): Date {
  const out = midnight(at)
  out.setDate(out.getDate() - out.getDay())
  return out
}

/**
 * A pool entry's name: the sha1 of the file's contents with its own extension
 * kept, so what is in the pool can still be opened by hand. Read in chunks
 * rather than whole — a gallery holds clips as well as pictures.
 *
 * **Asynchronous, and the whole of why the copy below is.** Reading a gallery
 * through takes real time (measured on 2523 files and 106MB: 1.85s), and this
 * runs in the main process while the library window is coming up. Done with
 * `readSync` it was 1.85s in which nothing was painted; awaited, the work is
 * handed to the thread pool and the window is drawn through it.
 */
async function poolId(file: string): Promise<string> {
  const hash = createHash('sha1')
  const handle = await fsp.open(file, 'r')
  try {
    const chunk = Buffer.alloc(1 << 20)
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (bytesRead <= 0) break
      hash.update(chunk.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex') + path.extname(file).toLowerCase()
}

/** Where an entry of that name lives, fanned out by its first two characters. */
function poolPath(directory: string, id: string): string {
  return path.join(directory, BACKUP_POOL, id.slice(0, 2), id)
}

/** Every file under a folder, as paths relative to it with `/` separators —
    which is what a manifest writes, a manifest being read on whatever machine
    the backup is carried to. */
function filesUnder(root: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...filesUnder(path.join(root, entry.name), rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/** Every folder in the backup directory this app made, oldest first. */
function keptBackups(directory: string): KeptBackup[] {
  let names: string[]
  try {
    names = fs.readdirSync(directory)
  } catch {
    return []
  }
  const out: KeptBackup[] = []
  for (const name of names) {
    const match = BACKUP_NAME.exec(name)
    if (!match) continue
    if (!fs.statSync(path.join(directory, name)).isDirectory()) continue
    out.push({
      name,
      date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      tier: (match[4] as BackupTier) ?? 'day'
    })
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/**
 * What today's backup stands for: the first of its year, of its month, of its
 * week, or nothing beyond the day.
 *
 * Anything already dated today is left out of the question — a second launch on
 * the same day is the same backup being taken again, and counting it would have
 * it find its own week already covered and file the replacement a rank lower.
 */
function tierFor(today: Date, kept: KeptBackup[]): BackupTier {
  const others = kept.filter((one) => one.date.getTime() !== midnight(today).getTime())
  const covered = (rank: number, from: Date): boolean =>
    others.some((one) => TIER_RANK[one.tier] >= rank && one.date >= from)

  if (!covered(TIER_RANK.year, new Date(today.getFullYear(), 0, 1))) return 'year'
  if (!covered(TIER_RANK.month, new Date(today.getFullYear(), today.getMonth(), 1))) return 'month'
  if (!covered(TIER_RANK.week, weekStart(today))) return 'week'
  return 'day'
}

/** Whether a backup has outlived what its tier is kept for. */
function expired(one: KeptBackup, today: Date): boolean {
  if (one.tier === 'year') return false
  if (one.tier === 'month') return one.date < monthsBefore(today, 12)
  if (one.tier === 'week') return one.date < monthsBefore(today, 3)
  return one.date < daysBefore(today, 7)
}

/**
 * Copies the library into the folder the Setting board's 起動時にバックアップ
 * を作成 row names, once, as the app starts.
 *
 * **One folder a day, named for the day and for what it stands for**, holding
 * `library.sqlite3`, a copy of each media folder, and the manifest that says
 * what it is. A backup per launch would fill the folder for anyone who opens
 * the app twice, and a single fixed name would leave one bad day with nothing
 * behind it. A second launch on the same day takes the day's folder away and
 * writes it again from scratch, so it is the library as it stands rather than
 * the two runs mixed together. Whatever has outlived its tier goes with it.
 *
 * The database is taken with `better-sqlite3`'s own `backup` rather than by
 * copying the file: it is in WAL mode, so the `.sqlite3` on its own is not the
 * whole of it — a copy taken while a write is in flight is a copy of half of
 * one. This drives SQLite's own backup API, which takes a consistent snapshot.
 *
 * What comes back is the path of the database inside that folder, which is what
 * the 読み込み row is pointed at.
 */
export async function backupDatabase(directory: string): Promise<string> {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')

  fs.mkdirSync(directory, { recursive: true })
  await absorbOwnCopies(directory)
  const kept = keptBackups(directory)
  const tier = tierFor(now, kept)

  /* **One backup a day.** Whatever this day already has goes — under whatever
     tag it was filed with, since the tag is worked out again from what the rest
     of the folder holds and can come out differently from one launch to the
     next. */
  for (const one of kept) {
    if (one.date.getTime() === midnight(now).getTime()) {
      fs.rmSync(path.join(directory, one.name), { recursive: true, force: true })
    }
  }

  const folder = path.join(directory, `library-${stamp}-${tier}`)
  fs.mkdirSync(folder, { recursive: true })

  const target = path.join(folder, 'library.sqlite3')
  fs.rmSync(target, { force: true })
  await db.backup(target)

  /* **The pictures go into the pool, and what this backup writes down is which
     of them it needs.** A file already in the pool is already this file — the
     name is its contents — so nothing is copied for it. */
  const root = app.getPath('userData')
  const files: Record<string, string> = {}
  for (const name of BACKUP_MEDIA_DIRS) {
    const from = path.join(root, name)
    if (!fs.existsSync(from)) continue
    for (const rel of filesUnder(from)) {
      const source = path.join(from, ...rel.split('/'))
      const id = await poolId(source)
      const dest = poolPath(directory, id)
      if (!fs.existsSync(dest)) {
        await fsp.mkdir(path.dirname(dest), { recursive: true })
        /* Written beside itself and moved into place: a copy interrupted
           halfway would otherwise leave a short file standing under a name that
           says what its contents are, and every backup after it would trust
           that name and copy nothing. */
        const half = `${dest}.part`
        await fsp.copyFile(source, half)
        await fsp.rename(half, dest)
      }
      files[`${name}/${rel}`] = id
    }
  }

  fs.writeFileSync(
    path.join(folder, BACKUP_MANIFEST),
    JSON.stringify(
      { app: 'from-visual-novel', createdAt: now.toISOString(), tier, pool: BACKUP_POOL, files },
      null,
      2
    )
  )

  /* And the ones that have outlived what their own tier is kept for. Done after
     the day's is written rather than before it: what is swept is read off the
     folder, and the folder is not what it will be until this launch's backup is
     in it. Today's own is never a candidate. */
  for (const one of keptBackups(directory)) {
    if (one.date.getTime() === midnight(now).getTime()) continue
    if (expired(one, now)) {
      fs.rmSync(path.join(directory, one.name), { recursive: true, force: true })
    }
  }

  sweepPool(directory)
  return target
}

/**
 * Takes the backups that carry their own copies of the pictures into the pool.
 *
 * Without this the saving only ever applies to backups made from here on, and a
 * folder filed as the year's is **kept forever** — so a library that had been
 * backed up before this would go on holding a whole copy of itself for good.
 *
 * **Nothing is removed until the pool has the file.** Each of the folder's own
 * files is put in the pool first, then the list is written — under a temporary
 * name and renamed, so a folder is either the one thing or the other and never
 * half of each — and only then are its copies deleted. Interrupted before the
 * rename, the folder is exactly as it was; interrupted after it, the copies are
 * simply still there and the next run takes them, which is what the second half
 * of this does for a folder whose list already says pool.
 */
async function absorbOwnCopies(directory: string): Promise<void> {
  for (const one of keptBackups(directory)) {
    const folder = path.join(directory, one.name)
    if (!fs.existsSync(path.join(folder, BACKUP_MANIFEST))) continue
    const manifest = readManifest(folder)
    if (!manifest) continue

    const own = BACKUP_MEDIA_DIRS.filter((name) => fs.existsSync(path.join(folder, name)))
    if (own.length === 0) continue

    // Already listed against the pool: its copies are what was left behind by
    // a run that stopped between the two steps.
    if (manifest.files) {
      for (const name of own) fs.rmSync(path.join(folder, name), { recursive: true, force: true })
      continue
    }

    const files: Record<string, string> = {}
    for (const name of own) {
      const from = path.join(folder, name)
      for (const rel of filesUnder(from)) {
        const source = path.join(from, ...rel.split('/'))
        const id = await poolId(source)
        const dest = poolPath(directory, id)
        if (!fs.existsSync(dest)) {
          await fsp.mkdir(path.dirname(dest), { recursive: true })
          const half = `${dest}.part`
          await fsp.copyFile(source, half)
          await fsp.rename(half, dest)
        }
        files[`${name}/${rel}`] = id
      }
    }

    const list = path.join(folder, BACKUP_MANIFEST)
    const half = `${list}.part`
    await fsp.writeFile(
      half,
      JSON.stringify({ ...manifest, media: undefined, pool: BACKUP_POOL, files }, null, 2)
    )
    await fsp.rename(half, list)
    for (const name of own) fs.rmSync(path.join(folder, name), { recursive: true, force: true })
  }
}

/** What a manifest holds. `files` and `pool` are what a backup sharing the pool
    writes; `media`, a list of folder names, is what one carrying its own copies
    wrote, and those are still read back as they were. */
interface BackupManifest {
  pool?: string
  files?: Record<string, string>
  media?: string[]
}

function readManifest(folder: string): BackupManifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, BACKUP_MANIFEST), 'utf8')) as BackupManifest
  } catch {
    return null
  }
}

/**
 * Clears the pool of every file no surviving backup asks for.
 *
 * This is the whole of what keeps it from growing: a picture taken out of the
 * library stops being listed by new backups, but stays in the pool while any
 * backup that had it is still there, and goes with the last of them. It runs
 * after the sweep of the folders above, so what it reads is what is left.
 *
 * **A manifest that cannot be read stops it.** A folder whose list is
 * unreadable is a backup whose files cannot be accounted for, and the pool is
 * the only copy of them — so nothing is swept that run rather than something
 * being deleted that is still needed. A folder with no manifest at all is a
 * bare database and asks for nothing.
 */
function sweepPool(directory: string): void {
  const poolDir = path.join(directory, BACKUP_POOL)
  if (!fs.existsSync(poolDir)) return

  const needed = new Set<string>()
  for (const one of keptBackups(directory)) {
    const folder = path.join(directory, one.name)
    if (!fs.existsSync(path.join(folder, BACKUP_MANIFEST))) continue
    const manifest = readManifest(folder)
    if (!manifest) return
    for (const id of Object.values(manifest.files ?? {})) needed.add(id)
  }

  for (const bucket of fs.readdirSync(poolDir)) {
    const dir = path.join(poolDir, bucket)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const entry of fs.readdirSync(dir)) {
      // A `.part` left by an interrupted copy is asked for by nothing either.
      if (!needed.has(entry)) fs.rmSync(path.join(dir, entry), { force: true })
    }
    if (fs.readdirSync(dir).length === 0) fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Clears `userData/icons` of every file no game is pointing at.
 *
 * The folder is written by the Add Game dialog's own preview — the icon pulled
 * out of the chosen executable — so it fills with the ones a dialog was
 * cancelled on, the ones a game was deleted with, and (before the file was
 * named for the executable rather than the occasion) another copy for every
 * time that box was ticked. What a game is actually using is one column, so
 * what is not in it is not being used by anything.
 *
 * Swept as the app starts, before any window: nothing is choosing an icon yet,
 * so a file that has just been written and not yet saved to a row cannot be
 * caught by it. Two games launched from one executable share a file now, which
 * is why the test is "no row points at it" rather than anything per game.
 */
export function pruneUnusedIcons(userDataDir: string): void {
  const dir = path.join(userDataDir, 'icons')
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    // Made on the first extraction; there may be none.
    return
  }
  const used = new Set(
    (
      db
        .prepare("SELECT icon_path FROM games WHERE icon_path IS NOT NULL AND icon_path <> ''")
        .all() as { icon_path: string }[]
    ).map((row) => path.resolve(row.icon_path).toLowerCase())
  )
  for (const name of names) {
    const file = path.join(dir, name)
    if (used.has(path.resolve(file).toLowerCase())) continue
    try {
      fs.rmSync(file, { force: true })
    } catch {
      // A file that will not go is a file that stays; this is housekeeping.
    }
  }
}

/**
 * Puts every setting back to what it opens as.
 *
 * The rows are simply dropped rather than written back as the defaults: an
 * unwritten key already reads as its default (`getSettings`), so an empty table
 * *is* the untouched state — and a build that adds a row later finds nothing
 * stale sitting under it.
 *
 * The library itself is untouched. This table holds nothing about the games.
 */
export function resetSettings(): AppSettings {
  db.prepare('DELETE FROM settings').run()
  return getSettings()
}

/** What a SQLite file begins with. A wrong file read back over the library
    would be worse than no restore at all, so this is checked first. */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')

/** Whether a path is a file this build would read back: it is there, and it
    begins the way a SQLite database does. */
export function isBackupFile(source: string): boolean {
  try {
    if (!fs.statSync(source).isFile()) return false
    const head = Buffer.alloc(SQLITE_MAGIC.length)
    const handle = fs.openSync(source, 'r')
    try {
      fs.readSync(handle, head, 0, head.length, 0)
    } finally {
      fs.closeSync(handle)
    }
    return head.equals(SQLITE_MAGIC)
  } catch {
    return false
  }
}

/**
 * Reads a backup back over the live database.
 *
 * The connection is closed first and the WAL and shared-memory files go with
 * it: they belong to the database that is being replaced, and left behind they
 * would be replayed over the one that arrives. The caller restarts the app —
 * every query in this process is against a handle that is now closed.
 */
export function restoreDatabase(source: string): void {
  const head = Buffer.alloc(SQLITE_MAGIC.length)
  const handle = fs.openSync(source, 'r')
  try {
    fs.readSync(handle, head, 0, head.length, 0)
  } finally {
    fs.closeSync(handle)
  }
  if (!head.equals(SQLITE_MAGIC)) {
    throw new Error(t('SQLite のデータベースファイルではありません'))
  }

  /* **The files come back before the database does.** A backup folder is what
     it is by the manifest lying beside the database it was pointed at — a bare
     `.sqlite3`, which is what every backup made before this is, has none, and
     then only the database is read back, exactly as it always was. The media is
     restored first because it is the step that can still be undone: nothing
     about the database has been touched yet, so a failure leaves the app
     running on the library it already had. */
  const folder = path.dirname(source)
  const manifest = fs.existsSync(path.join(folder, BACKUP_MANIFEST))
    ? readManifest(folder)
    : null
  if (manifest?.files) {
    restoreFromPool(folder, manifest.files)
  } else if (manifest) {
    restoreMedia(folder)
  }

  const target = path.join(app.getPath('userData'), 'library.sqlite3')
  db.close()
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(target + suffix, { force: true })
  }
  fs.copyFileSync(source, target)
}

/* Every folder the app itself writes under `userData`: the four the backup
   carries, and the three a capture is written to before the save dialog moves
   it. The backups are deliberately not among them — they are in the folder the
   起動時にバックアップを作成 row names, which is the player's own, and the one
   thing the 初期化 row promises to leave alone. */
const OWN_DIRS = [...BACKUP_MEDIA_DIRS, 'screenshots', 'videos', 'audio']

/**
 * Takes the library away entirely: the database — the games, the play time,
 * the routes, the plans, the settings — and every file it points at. What is
 * left under `userData` is what Chromium keeps there, which is nothing of the
 * player's. The caller restarts the app on an empty library, the way the
 * restore does, since every query in this process is against a handle that is
 * now closed.
 *
 * The files go first, for the reason the restore's come back first: a folder
 * that could not be removed leaves the database standing and the app running
 * on the library it already had, rather than a database gone from under
 * pictures nobody can reach any more.
 */
export function eraseLibrary(): void {
  const root = app.getPath('userData')
  for (const dir of OWN_DIRS) {
    fs.rmSync(path.join(root, dir), { recursive: true, force: true })
  }

  const target = path.join(root, 'library.sqlite3')
  db.close()
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(target + suffix, { force: true })
  }
}

/**
 * Builds each media folder back out of the pool, from the list the backup
 * wrote: every entry says where a file goes and which of the pool's files holds
 * its bytes.
 *
 * **The pool is beside the dated folder, not inside it**, which is the one
 * thing about this arrangement a person carrying a backup somewhere has to
 * know: the folder alone is a database and a list of files it does not have. It
 * is checked for before anything is moved, so being handed one on its own is
 * answered with a sentence rather than with a half-restored library.
 */
function restoreFromPool(folder: string, files: Record<string, string>): void {
  const directory = path.dirname(folder)
  const poolDir = path.join(directory, BACKUP_POOL)
  if (!fs.existsSync(poolDir)) {
    throw new Error(t('バックアップの {0} フォルダが見つかりません', BACKUP_POOL))
  }

  /* Grouped by the folder each file belongs to, so a folder is replaced whole
     and can be put back whole if it fails. */
  const byDir = new Map<string, { rel: string; id: string }[]>()
  for (const [key, id] of Object.entries(files)) {
    const cut = key.indexOf('/')
    if (cut < 0) continue
    const dir = key.slice(0, cut)
    if (!BACKUP_MEDIA_DIRS.includes(dir)) continue
    const list = byDir.get(dir) ?? []
    list.push({ rel: key.slice(cut + 1), id })
    byDir.set(dir, list)
  }

  const root = app.getPath('userData')
  for (const name of BACKUP_MEDIA_DIRS) {
    const list = byDir.get(name)
    if (!list) continue
    const to = path.join(root, name)
    const aside = `${to}.restoring`
    fs.rmSync(aside, { recursive: true, force: true })
    if (fs.existsSync(to)) fs.renameSync(to, aside)
    try {
      for (const { rel, id } of list) {
        const dest = path.join(to, ...rel.split('/'))
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(poolPath(directory, id), dest)
      }
    } catch (error) {
      fs.rmSync(to, { recursive: true, force: true })
      if (fs.existsSync(aside)) fs.renameSync(aside, to)
      throw error
    }
    fs.rmSync(aside, { recursive: true, force: true })
  }
}

/* Puts each media folder back as a backup that carried its own copies has it —
   which is every backup made before the pool. **The one it replaces is moved
   aside rather than deleted**, and put back if the copy fails partway: what is
   being replaced is the only copy of those pictures this machine has, and half
   of it is worse than either. */
function restoreMedia(folder: string): void {
  const root = app.getPath('userData')
  for (const name of BACKUP_MEDIA_DIRS) {
    const from = path.join(folder, name)
    if (!fs.existsSync(from)) continue
    const to = path.join(root, name)
    const aside = `${to}.restoring`
    fs.rmSync(aside, { recursive: true, force: true })
    if (fs.existsSync(to)) fs.renameSync(to, aside)
    try {
      fs.cpSync(from, to, { recursive: true })
    } catch (error) {
      fs.rmSync(to, { recursive: true, force: true })
      if (fs.existsSync(aside)) fs.renameSync(aside, to)
      throw error
    }
    fs.rmSync(aside, { recursive: true, force: true })
  }
}
