'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const log = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.LAUNCHER_DB || path.join(DATA_DIR, 'launcher.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    pw_hash    TEXT NOT NULL,
    pw_salt    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    topic     TEXT NOT NULL,
    payload   TEXT,
    source    TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_topic ON events(topic);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
`);

// --- Settings helpers ---
const _getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const _setSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);

function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  _setSetting.run(key, value == null ? null : String(value));
  return value;
}

log.info('db', 'database ready', { path: DB_PATH });

module.exports = {
  db,
  DB_PATH,
  getSetting,
  setSetting,
};
