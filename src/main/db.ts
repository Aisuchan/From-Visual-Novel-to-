import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import type {
  FooterStats,
  GameImage,
  GameWithStats,
  Group,
  LaunchPrefs,
  NewGameInput,
  NewGroupInput,
  NewRouteInput,
  ProgressState,
  Route,
  RoutePatch,
  Session,
  Tag
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
    median_score: 'REAL',
    clear_score: 'INTEGER',
    cleared_at: 'TEXT',
    clear_play_seconds: 'INTEGER'
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

function rowToGameWithStats(row: any): GameWithStats {
  const stats = db
    .prepare(
      /* Sessions launched with "Record Time" off are kept as history but left
         out of the stats the library shows. */
      `SELECT COALESCE(SUM(duration_seconds), 0) AS total, MAX(started_at) AS last
       FROM sessions WHERE game_id = ? AND recorded = 1`
    )
    .get(row.id) as { total: number; last: string | null }

  /* The Progress triangle's "played at all" reads the same rows the Play log
     puts a GAME START on, which includes the ones launched with "Record Time"
     off — so it is counted separately from the stats above. */
  const launched = (
    db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE game_id = ? AND ended_at IS NOT NULL')
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
    iconPath: row.icon_path,
    exePath: row.exe_path,
    groupName: row.group_name,
    useExeIcon: !!row.use_exe_icon,
    useShortName: !!row.use_short_name,
    useThumbnailAsDefault: !!row.use_thumbnail_default,
    progressState: (row.progress_state as GameWithStats['progressState']) ?? null,
    releaseDate: row.release_date ?? null,
    medianScore: row.median_score ?? null,
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
 */
export function setTotalPlaySeconds(gameId: number, seconds: number): void {
  const recorded = (
    db
      .prepare(
        'SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM sessions WHERE game_id = ? AND recorded = 1'
      )
      .get(gameId) as { total: number }
  ).total
  db.prepare('UPDATE games SET play_time_offset = ? WHERE id = ?').run(
    Math.round(seconds) - recorded,
    gameId
  )
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
 * images are added: oldest first, newest on the last page.
 */
export function listGameImages(gameId: number): GameImage[] {
  const rows = db
    .prepare('SELECT * FROM game_images WHERE game_id = ? ORDER BY id ASC')
    .all(gameId) as {
    id: number
    game_id: number
    file_path: string
    source: string
    created_at: string
  }[]

  return rows.map((row) => ({
    id: row.id,
    gameId: row.game_id,
    filePath: row.file_path,
    source: row.source === 'screenshot' ? 'screenshot' : 'manual',
    createdAt: row.created_at
  }))
}

export function addGameImages(
  gameId: number,
  filePaths: string[],
  source: GameImage['source'] = 'manual'
): GameImage[] {
  const insert = db.prepare('INSERT INTO game_images (game_id, file_path, source) VALUES (?, ?, ?)')
  const tx = db.transaction((paths: string[]) => {
    for (const filePath of paths) insert.run(gameId, filePath, source)
  })
  tx(filePaths)
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

export function setThumbnail(gameId: number, filePath: string): GameWithStats {
  db.prepare('UPDATE games SET thumbnail_path = ? WHERE id = ?').run(filePath, gameId)
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId)
  if (!row) throw new Error(`ゲームが見つかりません (id=${gameId})`)
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
  if (!row) throw new Error(`ゲームが見つかりません (id=${gameId})`)
  return rowToGameWithStats(row)
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
                          use_exe_icon, use_short_name, use_thumbnail_default, sort_order)
       VALUES (@title, @shortName, @thumbnailPath, @iconPath, @exePath, @groupName,
               @useExeIcon, @useShortName, @useThumbnailAsDefault, @sortOrder)`
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
      sortOrder: maxOrder + 1
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
       use_thumbnail_default = @useThumbnailAsDefault
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
    useThumbnailAsDefault: input.useThumbnailAsDefault ? 1 : 0
  })

  linkThumbnail(gameId, input.thumbnailPath)
  setGameTags(gameId, input.tagNames ?? [])

  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId)
  if (!row) throw new Error(`ゲームが見つかりません (id=${gameId})`)
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
  const rows = db
    .prepare('SELECT * FROM sessions WHERE game_id = ? ORDER BY started_at DESC, id DESC')
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

  const sumSince = (iso: string): number => {
    const result = db
      .prepare(
        `SELECT COALESCE(SUM(duration_seconds), 0) AS total
         FROM sessions WHERE started_at >= ? AND recorded = 1`
      )
      .get(iso) as { total: number }
    return result.total
  }

  return {
    todaySeconds: sumSince(startOfDay.toISOString()),
    weekSeconds: sumSince(startOfWeek.toISOString()),
    monthSeconds: sumSince(startOfMonth.toISOString())
  }
}
