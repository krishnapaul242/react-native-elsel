#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const HELP = `elsel — React Native element selector

Usage:
  elsel init [--skip-install] [--mcp | --no-mcp] [--from <spec>]
                              Set up elsel in this project (one command)
  elsel mcp [--root <dir>]    Start the MCP server (stdio) for AI agents
  elsel show [--root <dir>]   Print the most recent selection as Markdown
  elsel history [--root <dir>]

Quick start:
  npx react-native-elsel init
`;

function findRoot(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.elsel')) || fs.existsSync(path.join(dir, 'package.json'))) return dir;
    if (path.dirname(dir) === dir) return path.resolve(start);
  }
}

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = rootFlag !== -1 && args[rootFlag + 1] ? path.resolve(args[rootFlag + 1]) : findRoot(process.cwd());
const store = require('../server/store');

const flag = (name) => args.includes(name);
const value = (name) => (args.indexOf(name) !== -1 ? args[args.indexOf(name) + 1] : undefined);

switch (args[0]) {
  case 'init':
    require('../server/init')
      .init(rootFlag !== -1 ? root : process.cwd(), {
        from: value('--from'),
        install: !flag('--skip-install'),
        mcp: flag('--mcp') ? true : flag('--no-mcp') ? false : undefined,
      })
      .catch((err) => {
        console.error(`\x1b[31m✖ ${err.message}\x1b[0m`);
        process.exit(1);
      });
    break;
  case 'mcp':
    require('../server/mcp').startMcpServer(root);
    break;
  case 'show': {
    const latest = store.readLatest(root);
    process.stdout.write(latest ? latest.markdown : 'No selection yet.\n');
    break;
  }
  case 'history':
    for (const h of store.readHistory(root, 50)) {
      console.log(`<${h.name}> ${h.source ? `${h.source.file}:${h.source.line}` : '(unknown)'}  ${h.timestamp}`);
    }
    break;
  default:
    process.stdout.write(HELP);
    process.exit(args[0] && args[0] !== 'help' && args[0] !== '--help' ? 1 : 0);
}
