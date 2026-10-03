'use strict';

const { execFile } = require('child_process');

// Run a command with an argument array (never a shell string) to avoid injection.
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
        stdout: (stdout || '').toString(),
        stderr: (stderr || '').toString(),
      });
    });
  });
}

module.exports = { run };
