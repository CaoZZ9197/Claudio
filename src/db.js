import Database from "better-sqlite3";
import config from "./config.js";

const db = new Database(config.paths.db);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '',
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS liked_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL UNIQUE,
    liked_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: add cover_url if missing (for existing databases)
try {
  db.exec("ALTER TABLE liked_songs ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''");
} catch (e) {
  // column may already exist or table doesn't exist yet, ignore
}

// ── Messages ────────────────────────────────────────────────────────────────

const insertMessage = db.prepare(
  "INSERT INTO messages (role, content) VALUES (@role, @content)"
);

const getMessages = db.prepare(
  "SELECT id, role, content, timestamp FROM messages ORDER BY id DESC LIMIT @limit"
);

export function saveMessage(role, content) {
  return insertMessage.run({ role, content });
}

export function getRecentMessages(limit = 50) {
  return getMessages.all({ limit });
}

// ── Plays ───────────────────────────────────────────────────────────────────

const insertPlay = db.prepare(
  "INSERT INTO plays (title, artist, album, source_id) VALUES (@title, @artist, @album, @source_id)"
);

const getPlays = db.prepare(
  "SELECT id, title, artist, album, source_id, timestamp FROM plays ORDER BY id DESC LIMIT @limit"
);

export function savePlay({ title, artist = "", album = "", sourceId = "" }) {
  return insertPlay.run({ title, artist, album, source_id: sourceId });
}

export function getRecentPlays(limit = 50) {
  return getPlays.all({ limit });
}

// ── Play History Cleanup ─────────────────────────────────────────────────────

const getPlayedIdsStmt = db.prepare(
  "SELECT source_id FROM plays WHERE timestamp >= datetime('now', @daysDiff)"
);

const cleanupOldPlaysStmt = db.prepare(
  "DELETE FROM plays WHERE timestamp < datetime('now', @daysDiff)"
);

/**
 * 返回最近 N 天已播放的 source_id 数组（用于搜索去重）
 * @param {number} days - 天数，默认 14
 * @returns {string[]} source_id 数组
 */
export function getPlayedSongIds(days = 14) {
  const rows = getPlayedIdsStmt.all({ daysDiff: `-${days} days` });
  return rows.map((r) => r.source_id).filter(Boolean);
}

/**
 * 清理超过保留天数的播放记录
 * @param {number} days - 天数，默认 14
 * @returns {number} 删除的记录数
 */
export function cleanupOldPlays(days = 14) {
  const result = cleanupOldPlaysStmt.run({ daysDiff: `-${days} days` });
  if (result.changes > 0) {
    console.log(`[db] Cleaned up ${result.changes} old play records`);
  }
  return result.changes;
}

// ── Liked Songs ─────────────────────────────────────────────────────────────

const insertLikedSong = db.prepare(
  "INSERT OR IGNORE INTO liked_songs (title, artist, album, source_id, cover_url) VALUES (@title, @artist, @album, @source_id, @coverUrl)"
);

const deleteLikedSong = db.prepare(
  "DELETE FROM liked_songs WHERE source_id = @source_id"
);

const getLikedSongBySourceId = db.prepare(
  "SELECT * FROM liked_songs WHERE source_id = @source_id"
);

const getAllLikedSongs = db.prepare(
  "SELECT id, title, artist, album, source_id, cover_url, liked_at FROM liked_songs ORDER BY liked_at DESC LIMIT @limit OFFSET @offset"
);

const countLikedSongs = db.prepare("SELECT COUNT(*) AS count FROM liked_songs");

export function addLikedSong({ title, artist = "", album = "", sourceId, coverUrl = "" }) {
  return insertLikedSong.run({ title, artist, album, source_id: sourceId, cover_url: coverUrl });
}

export function removeLikedSong(sourceId) {
  return deleteLikedSong.run({ source_id: sourceId });
}

export function isLiked(sourceId) {
  return !!getLikedSongBySourceId.get({ source_id: sourceId });
}

export function getLikedSongById(sourceId) {
  return getLikedSongBySourceId.get({ source_id: sourceId });
}

export function getLikedSongs(limit = 100, offset = 0) {
  return getAllLikedSongs.all({ limit, offset });
}

export function getLikedSongsCount() {
  return countLikedSongs.get().count;
}

// ── Preferences ─────────────────────────────────────────────────────────────

const setPref = db.prepare(
  "INSERT INTO preferences (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

const getPref = db.prepare("SELECT value FROM preferences WHERE key = @key");

const getAllPrefs = db.prepare("SELECT key, value FROM preferences");

const deletePref = db.prepare("DELETE FROM preferences WHERE key = @key");

export function setPreference(key, value) {
  return setPref.run({ key, value: String(value) });
}

export function getPreference(key) {
  const row = getPref.get({ key });
  return row ? row.value : null;
}

export function getAllPreferences() {
  const rows = getAllPrefs.all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function deletePreference(key) {
  return deletePref.run({ key });
}

// ── Maintenance ─────────────────────────────────────────────────────────────

const countMessages = db.prepare("SELECT COUNT(*) AS count FROM messages");
const deleteOldestMessages = db.prepare(
  "DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY id ASC LIMIT @excess)"
);

export function cleanupMessages(max = 10000) {
  const { count } = countMessages.get();
  if (count > max) {
    const excess = count - max;
    deleteOldestMessages.run({ excess });
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function closeDb() {
  db.close();
}

export default db;
