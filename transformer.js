'use strict';

// Metro babel transformer that delegates to the project's own transformer and,
// in development bundles only, prepends `import 'react-native-elsel/auto'` to
// the app entry file. Prepended on line 1 so source maps don't shift.

const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

const upstreamPath = process.env.ELSEL_UPSTREAM_BABEL_TRANSFORMER;
if (!upstreamPath) throw new Error('[elsel] transformer loaded without withElementSelector() in metro.config.js');
const upstream = require(upstreamPath);

const INJECT = 'import "react-native-elsel/auto";';
const entriesByRoot = new Map();

function addFile(set, file) {
  try {
    if (fs.statSync(file).isFile()) {
      set.add(file);
      set.add(fs.realpathSync(file));
    }
  } catch {}
}

function entryFiles(projectRoot) {
  if (entriesByRoot.has(projectRoot)) return entriesByRoot.get(projectRoot);
  const set = new Set();
  const resolve = (id) => {
    try {
      addFile(set, require.resolve(id, { paths: [projectRoot] }));
    } catch {}
  };
  let main;
  try {
    main = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).main;
  } catch {}
  if (main) {
    const base = path.resolve(projectRoot, main);
    for (const ext of ['', '.js', '.jsx', '.ts', '.tsx']) addFile(set, base + ext);
    resolve(main);
  } else {
    for (const name of ['index.js', 'index.jsx', 'index.ts', 'index.tsx']) addFile(set, path.join(projectRoot, name));
    resolve('expo/AppEntry');
  }
  entriesByRoot.set(projectRoot, set);
  return set;
}

function shouldInject({ filename, options }) {
  if (!options || !options.dev || !options.projectRoot) return false;
  const env = options.customTransformOptions && options.customTransformOptions.environment;
  if (env === 'node' || env === 'react-server') return false; // Expo server bundles
  return entryFiles(options.projectRoot).has(path.resolve(options.projectRoot, filename));
}

module.exports = {
  ...upstream,
  transform(args) {
    return upstream.transform(shouldInject(args) ? { ...args, src: INJECT + args.src } : args);
  },
  getCacheKey(...args) {
    const base = typeof upstream.getCacheKey === 'function' ? upstream.getCacheKey(...args) : '';
    return `${base}$elsel-${version}$${upstreamPath}`;
  },
};
