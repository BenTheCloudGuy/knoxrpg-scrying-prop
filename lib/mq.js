'use strict';

// Lightweight in-process message queue / event bus.
// - publish(topic, payload): persists to SQLite `events` and fans out to subscribers.
// - subscribe(fn): receive every published event (used by the WebSocket bridge).
// This is deliberately simple so it can be swapped for a real broker (e.g. MQTT)
// later without changing call sites. Running prop apps will publish status/telemetry
// here for live streaming to the admin portal.

const { EventEmitter } = require('events');
const { db } = require('./db');
const log = require('./logger');

const bus = new EventEmitter();
bus.setMaxListeners(100);

const _insertEvent = db.prepare('INSERT INTO events (topic, payload, source) VALUES (?, ?, ?)');
const _recent = db.prepare('SELECT id, topic, payload, source, created_at FROM events ORDER BY id DESC LIMIT ?');
const _recentByTopic = db.prepare('SELECT id, topic, payload, source, created_at FROM events WHERE topic LIKE ? ORDER BY id DESC LIMIT ?');

function publish(topic, payload = {}, source = 'launcher') {
  let stored;
  try {
    const info = _insertEvent.run(topic, JSON.stringify(payload), source);
    stored = { id: info.lastInsertRowid, topic, payload, source, created_at: new Date().toISOString() };
  } catch (e) {
    log.error('mq', 'failed to persist event', { topic, error: e.message });
    stored = { id: null, topic, payload, source, created_at: new Date().toISOString() };
  }
  bus.emit('event', stored);
  return stored;
}

function subscribe(fn) {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}

function recent({ topic = '', limit = 100 } = {}) {
  const rows = topic
    ? _recentByTopic.all(topic.replace(/\*/g, '%'), limit)
    : _recent.all(limit);
  return rows.map((r) => ({ ...r, payload: safeParse(r.payload) })).reverse();
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return s; }
}

module.exports = { publish, subscribe, recent };
