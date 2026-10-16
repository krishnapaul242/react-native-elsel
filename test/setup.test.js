'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { patchConfig, init } = require('../server/init');
const { withElementSelector } = require('../metro');

const TRANSFORMER = path.join(__dirname, '..', 'transformer.js');

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elsel-setup-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

test('patchConfig wraps a multi-line export (Sentry + NativeWind style config)', () => {
  const src = `const { getSentryExpoConfig } = require('@sentry/react-native/metro')
const { withNativeWind } = require('nativewind/metro')
const config = getSentryExpoConfig(__dirname)
config.watchFolders = [__dirname]

module.exports = withNativeWind(config, {
  input: './global.css',
})
`;
  const out = patchConfig(src, __dirname);
  assert.match(out, /const \{ withElementSelector \} = require\('react-native-elsel\/metro'\)\nmodule\.exports = withElementSelector\(withNativeWind\(config, \{\n  input: '\.\/global\.css',\n\}\)\)\n$/);
  assert.ok(out.startsWith(src.split('\n\nmodule')[0]));
});

test('patchConfig keeps semicolons and handles ESM default export', () => {
  assert.match(
    patchConfig("const x = require('y');\nmodule.exports = mergeConfig(a, b);\n", __dirname),
    /require\('react-native-elsel\/metro'\);\nmodule\.exports = withElementSelector\(mergeConfig\(a, b\)\);/,
  );
  assert.match(
    patchConfig("import { getDefaultConfig } from 'expo/metro-config'\nexport default getDefaultConfig(import.meta.dirname)\n", __dirname),
    /import \{ withElementSelector \} from 'react-native-elsel\/metro'\nexport default withElementSelector\(getDefaultConfig\(import\.meta\.dirname\)\)/,
  );
  assert.equal(patchConfig('const a = 1\n', __dirname), null);
});

test('init: patches config, adds .mcp.json, is idempotent', async () => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { expo: '1', 'react-native': '1', 'react-native-elsel': '0.1.0' } }),
    'metro.config.js': "const { getDefaultConfig } = require('expo/metro-config')\nmodule.exports = getDefaultConfig(__dirname)\n",
    '.mcp.json': JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
  });
  const log = () => {};
  const done = await init(root, { mcp: true, log });
  assert.deepEqual(done, ['updated metro.config.js', 'added MCP server to .mcp.json']);
  const mcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['other', 'elsel']);
  assert.deepEqual(await init(root, { mcp: true, log }), []);
  assert.equal(fs.readFileSync(path.join(root, 'metro.config.js'), 'utf8').match(/withElementSelector/g).length, 2);
});

test('init: creates metro.config.js when missing and rejects non-RN projects', async () => {
  const root = project({ 'package.json': JSON.stringify({ dependencies: { 'react-native': '1', 'react-native-elsel': '0' } }) });
  await init(root, { mcp: false, log: () => {} });
  assert.match(fs.readFileSync(path.join(root, 'metro.config.js'), 'utf8'), /@react-native\/metro-config/);
  await assert.rejects(init(project({ 'package.json': '{}' }), { mcp: false, log: () => {} }), /React Native/);
});

test('withElementSelector swaps in the wrapping transformer once, keeping the upstream', () => {
  const upstream = path.join(__dirname, 'fixtures', 'upstream-transformer.js');
  const out = withElementSelector({ projectRoot: '/tmp', transformer: { babelTransformerPath: upstream, other: 1 } });
  assert.equal(out.transformer.babelTransformerPath, TRANSFORMER);
  assert.equal(out.transformer.other, 1);
  assert.equal(process.env.ELSEL_UPSTREAM_BABEL_TRANSFORMER, upstream);
  assert.match(out.cacheVersion, /^elsel-/);
  const twice = withElementSelector(out);
  assert.equal(twice.cacheVersion, out.cacheVersion);
  const off = withElementSelector({ transformer: { babelTransformerPath: upstream } }, { autoWrap: false });
  assert.equal(off.transformer.babelTransformerPath, upstream);
});

test('transformer injects the auto import into the dev entry file only', () => {
  const root = project({ 'package.json': JSON.stringify({ main: 'index.tsx' }), 'index.tsx': 'x', 'src/App.tsx': 'y' });
  process.env.ELSEL_UPSTREAM_BABEL_TRANSFORMER = path.join(__dirname, 'fixtures', 'upstream-transformer.js');
  delete require.cache[TRANSFORMER];
  const t = require(TRANSFORMER);
  const run = (filename, dev, extra = {}) => t.transform({ filename, src: 'APP', options: { dev, projectRoot: root, ...extra } }).src;

  assert.equal(run('index.tsx', true), 'import "react-native-elsel/auto";APP');
  assert.equal(run(path.join(root, 'index.tsx'), true), 'import "react-native-elsel/auto";APP');
  assert.equal(run('index.tsx', false), 'APP');
  assert.equal(run('src/App.tsx', true), 'APP');
  assert.equal(run('index.tsx', true, { customTransformOptions: { environment: 'node' } }), 'APP');
  assert.match(t.getCacheKey(), /^upstream-key\$elsel-/);
});
