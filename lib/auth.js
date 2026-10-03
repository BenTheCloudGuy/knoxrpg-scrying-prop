'use strict';

const crypto = require('crypto');
const { db } = require('./db');
const log = require('./logger');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const COOKIE_NAME = 'knox_sess';
const SCRYPT_KEYLEN = 64;

// Default seed credentials (override with env). Stored only as a scrypt hash.
const SEED_USER = process.env.ADMIN_USER || 'Admin';
const SEED_PASS = process.env.ADMIN_PASSWORD || 'BMM@dmin1979';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

const _getUser = db.prepare('SELECT * FROM users WHERE username = ?');
const _insertUser = db.prepare('INSERT INTO users (username, pw_hash, pw_salt) VALUES (?, ?, ?)');
const _insertSession = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)');
const _getSession = db.prepare("SELECT s.token, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?");
const _deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const _purgeExpired = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')");

// Seed the admin account once.
function ensureSeedUser() {
  if (!_getUser.get(SEED_USER)) {
    const { hash, salt } = hashPassword(SEED_PASS);
    _insertUser.run(SEED_USER, hash, salt);
    log.warn('auth', `seeded admin user "${SEED_USER}" — change this password`);
  }
}
ensureSeedUser();

function login(username, password) {
  const user = _getUser.get(username);
  if (!user) return null;
  if (!verifyPassword(password, user.pw_hash, user.pw_salt)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
  _insertSession.run(token, user.id, expires);
  return { token, username: user.username, maxAge: SESSION_TTL_MS };
}

function logout(token) {
  if (token) _deleteSession.run(token);
}

function validate(token) {
  if (!token) return null;
  _purgeExpired.run();
  const s = _getSession.get(token);
  if (!s) return null;
  return { username: s.username, token };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function tokenFromReq(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

// Express middleware: require a valid session, else 401.
function requireAuth(req, res, next) {
  const session = validate(tokenFromReq(req));
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.user = session;
  next();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  login,
  logout,
  validate,
  tokenFromReq,
  requireAuth,
};
