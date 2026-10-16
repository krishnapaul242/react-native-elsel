'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

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

function onPath(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  return (process.env.PATH || '')
    .split(path.delimiter)
    .some((dir) => dir && exts.some((ext) => fs.existsSync(path.join(dir, cmd + ext))));
}

/**
 * launch-editor spots a running VS Code (or Cursor, Windsurf, ...) and runs its
 * CLI by bare name, e.g. `code`, which fails when that command was never
 * installed on PATH. On macOS the CLI also ships inside the app bundle, so use
 * that copy instead.
 */
function resolveEditor(editor) {
  if (editor || process.env.LAUNCH_EDITOR || process.platform !== 'darwin') return editor;
  let cmd;
  try {
    [cmd] = require('launch-editor/guess')();
  } catch {
    return editor;
  }
  if (!cmd || cmd.includes('/') || onPath(cmd)) return editor;
  try {
    const processes = require('child_process').execFileSync('ps', ['x', '-o', 'comm='], { encoding: 'utf8' }).split('\n');
    for (const proc of processes) {
      const bundle = proc.match(/^(.*?\.app)\/Contents\/MacOS\//)?.[1];
      const cli = bundle && path.join(bundle, 'Contents/Resources/app/bin', cmd);
      if (cli && fs.existsSync(cli)) return JSON.stringify(cli); // quoted: launch-editor shell-parses this
    }
  } catch {}
  return editor;
}

function openInEditor(file, line, column, editor) {
  const launch = require('launch-editor');
  return new Promise((resolve) => {
    let failed = false;
    launch(`${file}:${line || 1}:${column || 1}`, resolveEditor(editor), (_file, message) => {
      failed = true;
      resolve({ ok: false, error: message || 'Could not launch editor' });
    });
    // launch-editor only reports failures; give it a moment to do so.
    setTimeout(() => !failed && resolve({ ok: true }), 300);
  });
}

module.exports = { copyToClipboard, captureScreenshot, openInEditor };
