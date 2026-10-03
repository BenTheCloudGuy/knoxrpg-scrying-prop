'use strict';

const os = require('os');
const path = require('path');
process.env.LAUNCHER_DB = path.join(os.tmpdir(), `knox-test-mq-${process.pid}.db`);

const test = require('node:test');
const assert = require('node:assert');
const mq = require('../lib/mq');
const { getSetting, setSetting } = require('../lib/db');

test('publish persists and notifies subscribers', () => {
  const received = [];
  const off = mq.subscribe((e) => received.push(e));
  const ev = mq.publish('test.topic', { n: 1 }, 'unit');
  assert.strictEqual(ev.topic, 'test.topic');
  assert.deepStrictEqual(ev.payload, { n: 1 });
  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0].topic, 'test.topic');
  off();
  mq.publish('test.topic', { n: 2 });
  assert.strictEqual(received.length, 1, 'unsubscribed listener should not fire');
});

test('recent returns events (oldest-last) with topic filter', () => {
  mq.publish('alpha.one', { a: 1 });
  mq.publish('beta.one', { b: 1 });
  const all = mq.recent({ limit: 10 });
  assert.ok(all.length >= 2);
  const alpha = mq.recent({ topic: 'alpha.*', limit: 10 });
  assert.ok(alpha.every((e) => e.topic.startsWith('alpha.')));
});

test('settings upsert round-trips', () => {
  assert.strictEqual(getSetting('missing', 'fallback'), 'fallback');
  setSetting('kiosk_display', ':0');
  assert.strictEqual(getSetting('kiosk_display'), ':0');
  setSetting('kiosk_display', ':1');
  assert.strictEqual(getSetting('kiosk_display'), ':1');
});
