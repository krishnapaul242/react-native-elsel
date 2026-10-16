'use strict';

const { execFile } = require('child_process');
const fs = require('fs');

function run(cmd, args, { input, timeout = 8000, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, encoding, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
    if (input != null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

async function copyToClipboard(text) {
  const candidates =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : process.platform === 'win32'
        ? [['clip', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
          ];
  for (const [cmd, args] of candidates) {
    try {
      await run(cmd, args, { input: text });
      return true;
    } catch {}
  }
  return false;
}

/** Screenshot the simulator/emulator the app is running on. Best effort. */
async function captureScreenshot(platform, outFile) {
  try {
    if (platform === 'ios' && process.platform === 'darwin') {
      await run('xcrun', ['simctl', 'io', 'booted', 'screenshot', '--type=png', outFile]);
      return fs.existsSync(outFile);
    }
    if (platform === 'android') {
      const png = await run('adb', ['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
      if (png && png.length > 0) {
        fs.writeFileSync(outFile, png);
        return true;
      }
    }
  } catch {}
  return false;
}

function openInEditor(file, line, column, editor) {
  const launch = require('launch-editor');
  return new Promise((resolve) => {
    let failed = false;
    launch(`${file}:${line || 1}:${column || 1}`, editor, (_file, message) => {
      failed = true;
      resolve({ ok: false, error: message || 'Could not launch editor' });
    });
    // launch-editor only reports failures; give it a moment to do so.
    setTimeout(() => !failed && resolve({ ok: true }), 300);
  });
}

module.exports = { copyToClipboard, captureScreenshot, openInEditor };
