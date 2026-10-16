'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { createMiddleware } = require('../server/middleware');
const { withElementSelector } = require('../metro');
const { startMcpServer } = require('../server/mcp');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elsel-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(
    path.join(root, 'src/Home.tsx'),
    ['import {Button} from "./Button";', 'export function Home() {', '  return (', '    <Button title="Save" />', '  );', '}'].join('\n'),
  );
  return root;
}

const selection = (root) => ({
  element: {
    name: 'Button',
    kind: 'composite',
    source: { file: path.join(root, 'src/Home.tsx'), line: 4, column: 5, isLibrary: false },
    props: { title: 'Save', onPress: 'ƒ onPress()' },
    style: { padding: 8 },
    frame: { x: 10, y: 20, width: 100, height: 40 },
  },
  chain: [
    { name: 'App', kind: 'composite', source: null },
    { name: 'Home', kind: 'composite', source: { file: path.join(root, 'src/App.tsx'), line: 9, column: 3, isLibrary: false } },
    { name: 'Button', kind: 'composite', source: { file: path.join(root, 'src/Home.tsx'), line: 4, column: 5, isLibrary: false } },
    { name: 'View', kind: 'composite', source: { file: '/x/node_modules/react-native/Button.js', line: 1, column: 1, isLibrary: true } },
  ],
  platform: 'web',
  window: { width: 390, height: 844 },
  timestamp: '2026-10-14T10:00:00.000Z',
});

async function withServer(root, fn) {
  const mw = createMiddleware({ projectRoot: root, log: false, screenshot: false });
  const server = http.createServer((req, res) => mw(req, res, () => send(res, 418, 'metro')));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}
const send = (res, status, body) => {
  res.statusCode = status;
  res.end(body);
};
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('middleware: ping, passthrough and unknown routes', async () => {
  const root = tmpProject();
  await withServer(root, async (base) => {
    const ping = await (await fetch(`${base}/__elsel/ping`)).json();
    assert.equal(ping.ok, true);
    assert.equal(ping.projectRoot, root);
    assert.equal((await fetch(`${base}/index.bundle`)).status, 418);
    assert.equal((await fetch(`${base}/__elsel/nope`)).status, 404);
    assert.equal((await post(`${base}/__elsel/open`, {})).status, 400);
    assert.equal((await post(`${base}/__elsel/open`, { file: 'missing.tsx', line: 1 })).status, 404);
  });
});

test('middleware: select writes json, markdown and history', async () => {
  const root = tmpProject();
  await withServer(root, async (base) => {
    const res = await post(`${base}/__elsel/select`, { selection: selection(root) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, file: path.join('.elsel', 'selection.md'), screenshot: false });
  });
  const dir = path.join(root, '.elsel');
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '*\n');
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'selection.json'), 'utf8'));
  assert.equal(json.element.source.file, path.join('src', 'Home.tsx'));
  assert.match(json.code, />\s+4 \|\s+<Button title="Save" \/>/);
  const md = fs.readFileSync(path.join(dir, 'selection.md'), 'utf8');
  assert.match(md, /# Selected element: <Button>/);
  assert.match(md, /\*\*Source:\*\* `src\/Home.tsx:4:5`/);
  assert.match(md, /Component path:\*\* Home › Button/);
  assert.doesNotMatch(md, /node_modules/);
  assert.equal(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('withElementSelector chains existing enhanceMiddleware and handles async configs', async () => {
  const calls = [];
  const config = { projectRoot: '/tmp', server: { port: 8081, enhanceMiddleware: (m) => (req, res, next) => (calls.push('prev'), m(req, res, next)) } };
  const out = withElementSelector(config);
  assert.equal(out.server.port, 8081);
  const mw = out.server.enhanceMiddleware(() => calls.push('metro'), {});
  mw({ url: '/index.bundle' }, {}, () => {});
  assert.deepEqual(calls, ['prev', 'metro']);
  const asyncOut = await withElementSelector(Promise.resolve({ server: {} }));
  assert.equal(typeof asyncOut.server.enhanceMiddleware, 'function');
});

test('mcp: initialize, list tools, read selection', async () => {
  const root = tmpProject();
  await withServer(root, (base) => post(`${base}/__elsel/select`, { selection: selection(root) }));

  const input = new PassThrough();
  const output = new PassThrough();
  const rl = startMcpServer(root, { input, output });
  const responses = [];
  output.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((l) => responses.push(JSON.parse(l))));
  const rpc = (msg) => input.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

  rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  rpc({ method: 'notifications/initialized' });
  rpc({ id: 2, method: 'tools/list' });
  rpc({ id: 3, method: 'tools/call', params: { name: 'get_selected_element', arguments: {} } });
  rpc({ id: 4, method: 'tools/call', params: { name: 'list_recent_selections', arguments: {} } });
  rpc({ id: 5, method: 'bogus' });
  await new Promise((r) => setTimeout(r, 100));
  rl.close();

  const byId = Object.fromEntries(responses.map((r) => [r.id, r]));
  assert.equal(responses.length, 5); // notification gets no reply
  assert.equal(byId[1].result.protocolVersion, '2025-06-18');
  assert.deepEqual(byId[2].result.tools.map((t) => t.name), ['get_selected_element', 'wait_for_selection', 'list_recent_selections']);
  assert.match(byId[3].result.content[0].text, /src\/Home.tsx:4:5/);
  assert.match(byId[4].result.content[0].text, /<Button> src\/Home.tsx:4:5/);
  assert.equal(byId[5].error.code, -32601);
});
