'use strict';

// `elsel init`: install the package and wire it into metro.config.js (and
// optionally Claude Code) with as little as possible changed in the project.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const PKG = 'react-native-elsel';
const CONFIG_NAMES = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs'];

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function installCommand(pm, spec) {
  switch (pm) {
    case 'yarn':
      return ['yarn', ['add', '--dev', spec]];
    case 'pnpm':
      return ['pnpm', ['add', '--save-dev', spec]];
    case 'bun':
      return ['bun', ['add', '--dev', spec]];
    default:
      return ['npm', ['install', '--save-dev', spec]];
  }
}

function newConfig(isExpo) {
  return isExpo
    ? `const { getDefaultConfig } = require('expo/metro-config')
const { withElementSelector } = require('${PKG}/metro')

module.exports = withElementSelector(getDefaultConfig(__dirname))
`
    : `const { getDefaultConfig } = require('@react-native/metro-config')
const { withElementSelector } = require('${PKG}/metro')

module.exports = withElementSelector(getDefaultConfig(__dirname))
`;
}

function loadParser(root) {
  for (const paths of [[root], [__dirname]]) {
    try {
      return require(require.resolve('@babel/parser', { paths }));
    } catch {}
  }
  return null;
}

/** Locate the exported config expression: [start, end, isESM] or null. */
function findExport(source, root) {
  const parser = loadParser(root);
  if (parser) {
    const ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['typescript'], errorRecovery: true });
    let found = null;
    for (const node of ast.program.body) {
      if (node.type === 'ExportDefaultDeclaration') found = { stmt: node, expr: node.declaration, esm: true };
      const e = node.type === 'ExpressionStatement' && node.expression;
      if (
        e &&
        e.type === 'AssignmentExpression' &&
        e.left.type === 'MemberExpression' &&
        e.left.object.name === 'module' &&
        (e.left.property.name === 'exports' || e.left.property.value === 'exports')
      ) {
        found = { stmt: node, expr: e.right, esm: false };
      }
    }
    return found && { stmtStart: found.stmt.start, start: found.expr.start, end: found.expr.end, esm: found.esm };
  }
  // No parser: handle the common case of `module.exports = …` being the last statement.
  const m = source.match(/(^|\n)(module\.exports\s*=\s*)([\s\S]+?);?\s*$/);
  if (!m) return null;
  const stmtStart = m.index + m[1].length;
  const start = stmtStart + m[2].length;
  return { stmtStart, start, end: start + m[3].length, esm: false };
}

function patchConfig(source, root) {
  const exp = findExport(source, root);
  if (!exp) return null;
  const semi = /require\([^)]*\);\s*$/m.test(source) ? ';' : '';
  const importLine = exp.esm
    ? `import { withElementSelector } from '${PKG}/metro'${semi}\n`
    : `const { withElementSelector } = require('${PKG}/metro')${semi}\n`;
  const expr = source.slice(exp.start, exp.end);
  return (
    source.slice(0, exp.stmtStart) +
    importLine +
    source.slice(exp.stmtStart, exp.start) +
    `withElementSelector(${expr})` +
    source.slice(exp.end)
  );
}

function ask(question, defaultYes) {
  if (!process.stdin.isTTY) return Promise.resolve(defaultYes);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a ? a.startsWith('y') : defaultYes);
    }),
  );
}

function addMcpConfig(root) {
  const file = path.join(root, '.mcp.json');
  let json = {};
  if (fs.existsSync(file)) {
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { ok: false, reason: '.mcp.json is not valid JSON' };
    }
  }
  json.mcpServers = json.mcpServers || {};
  if (json.mcpServers.elsel) return { ok: true, existed: true };
  json.mcpServers.elsel = { command: 'npx', args: ['elsel', 'mcp'] };
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return { ok: true };
}

/**
 * @param {string} root
 * @param {{ from?: string, install?: boolean, mcp?: boolean, log?: (s: string) => void }} opts
 */
async function init(root, opts = {}) {
  const log = opts.log || console.log;
  const pkgFile = path.join(root, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new Error(`No package.json in ${root}. Run this from your app's directory.`);
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['react-native']) throw new Error('This does not look like a React Native project (no react-native dependency).');
  const isExpo = Boolean(deps.expo);
  const done = [];

  // 1. Install
  if (deps[PKG] && !opts.from) {
    log(c.dim(`• ${PKG} already installed`));
  } else if (opts.install === false) {
    log(c.dim('• Skipping install (--skip-install)'));
  } else {
    const pm = detectPackageManager(root);
    const [cmd, args] = installCommand(pm, opts.from || PKG);
    log(`• Installing with ${pm}: ${c.dim(`${cmd} ${args.join(' ')}`)}`);
    const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`${cmd} exited with code ${r.status}`);
    done.push(`installed ${PKG} (dev dependency)`);
  }

  // 2. metro.config
  const configName = CONFIG_NAMES.find((n) => fs.existsSync(path.join(root, n)));
  if (!configName) {
    fs.writeFileSync(path.join(root, 'metro.config.js'), newConfig(isExpo));
    log(`• Created ${c.bold('metro.config.js')}`);
    done.push('created metro.config.js');
  } else {
    const file = path.join(root, configName);
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes('withElementSelector')) {
      log(c.dim(`• ${configName} already uses withElementSelector`));
    } else {
      const patched = patchConfig(source, root);
      if (!patched) {
        log(c.yellow(`! Could not find the exported config in ${configName}. Wrap it manually:`));
        log(`    const { withElementSelector } = require('${PKG}/metro')`);
        log('    module.exports = withElementSelector(<your config>)');
      } else {
        fs.writeFileSync(file, patched);
        log(`• Updated ${c.bold(configName)}:`);
        for (const line of patched.split('\n').filter((l) => l.includes('withElementSelector'))) log(c.green(`    + ${line.trim()}`));
        done.push(`updated ${configName}`);
      }
    }
  }

  // 3. Claude Code
  const wantMcp =
    opts.mcp !== undefined
      ? opts.mcp
      : await ask('Add elsel to Claude Code for this project (.mcp.json, shared via git)?', true);
  if (wantMcp) {
    const r = addMcpConfig(root);
    if (!r.ok) log(c.yellow(`! ${r.reason}; skipped. Run: claude mcp add elsel -- npx elsel mcp`));
    else if (r.existed) log(c.dim('• .mcp.json already has elsel'));
    else {
      log(`• Added elsel to ${c.bold('.mcp.json')}`);
      done.push('added MCP server to .mcp.json');
    }
  } else {
    log(c.dim('• Skipped Claude Code. Later: claude mcp add elsel -- npx elsel mcp'));
  }

  log('');
  log(c.green(c.bold('elsel is ready.')) + ' No changes to your app code are needed.');
  log(`  1. Restart Metro: ${c.bold(isExpo ? 'npx expo start --clear' : 'npx react-native start --reset-cache')}`);
  log('  2. Long-press any element (right-click on web / Android with a mouse).');
  log(`  3. ${c.bold('Send to AI')} in the panel → ask Claude Code about "the selected element".`);
  return done;
}

module.exports = { init, patchConfig, detectPackageManager };
