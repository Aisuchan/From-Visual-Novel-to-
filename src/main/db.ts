import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import type {
  FooterStats,
  GameImage,
  GameWithStats,
  LaunchPrefs,
  NewGameInput,
  Session
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

  addMissingColumns('games', {
    use_short_name: 'INTEGER NOT NULL DEFAULT 0',
    use_thumbnail_default: 'INTEGER NOT NULL DEFAULT 0',
    // Manual correction to the total play time, kept as an offset so sessions
    // recorded after the edit still accumulate on top of it.
    play_time_offset: 'INTEGER NOT NULL DEFAULT 0'
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

function rowToGameWithStats(row: any): GameWithStats {
  const stats = db
    .prepare(
      `SELECT COALESCE(SUM(duration_seconds), 0) AS total, MAX(started_at) AS last
       FROM sessions WHERE game_id = ?`
    )
    .get(row.id) as { total: number; last: string | null }

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
    createdAt: row.created_at,
    stats: {
      totalPlaySeconds: Math.max(0, stats.total + (row.play_time_offset ?? 0)),
      lastPlayedAt: stats.last
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
      .prepare('SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM sessions WHERE game_id = ?')
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
  const insert = db.prepare(
    'INSERT INTO game_images (game_id, file_path, source) VALUES (?, ?, ?)'
  )
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

export function setThumbnail(gameId: number, filePath: string): GameWithStats {
  db.prepare('UPDATE games SET thumbnail_path = ? WHERE id = ?').run(filePath, gameId)
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
    return { gameId, recordTime: true, useRecorderPanel: true, runAsAdmin: false, keepSetting: false }
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

export function endSession(sessionId: number): Session {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as {
    id: number
    game_id: number
    started_at: string
    ended_at: string | null
    duration_seconds: number
    recorded: number
  }

  const endedAt = new Date().toISOString()
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(row.started_at).getTime()) / 1000)
  )

  db.prepare('UPDATE sessions SET ended_at = ?, duration_seconds = ? WHERE id = ?').run(
    endedAt,
    durationSeconds,
    sessionId
  )

  return {
    id: row.id,
    gameId: row.game_id,
    startedAt: row.started_at,
    endedAt,
    durationSeconds,
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
        `SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM sessions WHERE started_at >= ?`
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
