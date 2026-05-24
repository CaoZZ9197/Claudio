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
`);

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
