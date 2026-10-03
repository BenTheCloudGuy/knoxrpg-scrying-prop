'use strict';

// Isolate DB side effects to a temp file before loading modules that touch it.
const os = require('os');
const path = require('path');
process.env.LAUNCHER_DB = path.join(os.tmpdir(), `knox-test-version-${process.pid}.db`);

const test = require('node:test');
const assert = require('node:assert');
const games = require('../lib/games');

test('compareTags orders semver correctly', () => {
  assert.strictEqual(games.compareTags('v1.2.0', 'v1.1.9'), 1);
  assert.strictEqual(games.compareTags('1.0.0', 'v1.0.0'), 0);
  assert.strictEqual(games.compareTags('v2.0.0', 'v10.0.0'), -1);
  assert.strictEqual(games.compareTags('v1.0', 'v1.0.0'), 0);
  assert.strictEqual(games.compareTags('v1.0.1', 'v1.0'), 1);
});

test('pickLatest returns the highest valid semver tag', () => {
  assert.strictEqual(games.pickLatest(['v1.0.0', 'v1.2.0', 'v1.1.5']), 'v1.2.0');
  assert.strictEqual(games.pickLatest(['v2.0.0', 'nightly', 'v1.9.9']), 'v2.0.0');
  assert.strictEqual(games.pickLatest(['beta', 'latest']), null);
  assert.strictEqual(games.pickLatest([]), null);
});
