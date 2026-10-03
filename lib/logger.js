'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const KEEP_FILES = 20; // prune old launcher logs beyond this many

function ts() {
  return new Date().toISOString();
}

function fileStamp() {
  return ts().replace(/[:.]/g, '-');
}

class Logger {
  constructor() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    this.file = path.join(LOG_DIR, `launcher-${fileStamp()}.log`);
    this.stream = fs.createWriteStream(this.file, { flags: 'a' });
    this._pruneOld();
    this.info('logger', 'launcher log started', { file: this.file });
  }

  _pruneOld() {
    try {
      const files = fs.readdirSync(LOG_DIR)
        .filter((f) => /^launcher-.*\.log$/.test(f))
        .map((f) => ({ f, t: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const { f } of files.slice(KEEP_FILES)) {
        fs.unlinkSync(path.join(LOG_DIR, f));
      }
    } catch (e) { /* non-fatal */ }
  }

  _write(level, scope, message, meta) {
    const line = JSON.stringify({ t: ts(), level, scope, message, ...(meta ? { meta } : {}) });
    try { this.stream.write(line + '\n'); } catch (e) { /* ignore */ }
    const out = `[${level}] ${scope}: ${message}`;
    if (level === 'error') console.error(out);
    else console.log(out);
    return line;
  }

  info(scope, message, meta) { return this._write('info', scope, message, meta); }
  warn(scope, message, meta) { return this._write('warn', scope, message, meta); }
  error(scope, message, meta) { return this._write('error', scope, message, meta); }

  // List available launcher log files, newest first.
  listFiles() {
    try {
      return fs.readdirSync(LOG_DIR)
        .filter((f) => /^launcher-.*\.log$/.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(LOG_DIR, f));
          return { name: f, size: st.size, modified: st.mtime.toISOString(), current: path.join(LOG_DIR, f) === this.file };
        })
        .sort((a, b) => (a.modified < b.modified ? 1 : -1));
    } catch (e) {
      return [];
    }
  }

  // Read lines from a log file with optional case-insensitive search and tail paging.
  // Returns newest-last. offset counts from the end (0 = latest page).
  read({ file, q = '', limit = 200, offset = 0 } = {}) {
    const target = file
      ? path.join(LOG_DIR, path.basename(file))
      : this.file;
    if (!fs.existsSync(target)) return { file: path.basename(target), total: 0, lines: [] };

    let lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
    if (q) {
      const needle = q.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(needle));
    }
    const total = lines.length;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    const page = lines.slice(start, end).map((l) => {
      try { return JSON.parse(l); } catch (e) { return { t: null, level: 'raw', scope: '', message: l }; }
    });
    return { file: path.basename(target), total, offset, limit, lines: page };
  }
}

module.exports = new Logger();
