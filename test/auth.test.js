'use strict';

const os = require('os');
const path = require('path');
process.env.LAUNCHER_DB = path.join(os.tmpdir(), `knox-test-auth-${process.pid}.db`);
process.env.ADMIN_USER = 'Admin';
process.env.ADMIN_PASSWORD = 'TestPass123!';

const test = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');

test('hashPassword + verifyPassword round-trips', () => {
  const { hash, salt } = auth.hashPassword('correct horse');
  assert.ok(hash && salt);
  assert.strictEqual(auth.verifyPassword('correct horse', hash, salt), true);
  assert.strictEqual(auth.verifyPassword('wrong horse', hash, salt), false);
});

test('seeded admin can log in and the session validates', () => {
  const session = auth.login('Admin', 'TestPass123!');
  assert.ok(session && session.token);
  assert.strictEqual(session.username, 'Admin');
  const v = auth.validate(session.token);
  assert.ok(v);
  assert.strictEqual(v.username, 'Admin');
});

test('bad credentials are rejected', () => {
  assert.strictEqual(auth.login('Admin', 'nope'), null);
  assert.strictEqual(auth.login('ghost', 'whatever'), null);
});

test('logout invalidates the session', () => {
  const session = auth.login('Admin', 'TestPass123!');
  auth.logout(session.token);
  assert.strictEqual(auth.validate(session.token), null);
});
