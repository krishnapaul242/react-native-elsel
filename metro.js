'use strict';

const path = require('path');
const { createMiddleware } = require('./server/middleware');
const { version } = require('./package.json');

const TRANSFORMER = path.join(__dirname, 'transformer.js');

function defaultBabelTransformer(projectRoot) {
  for (const id of ['@expo/metro-config/babel-transformer', '@react-native/metro-babel-transformer', 'metro-babel-transformer']) {
    try {
      return require.resolve(id, { paths: [projectRoot] });
    } catch {}
  }
  return null;
}

/**
 * Adds elsel to Metro:
 *  - dev endpoints (open in editor, copy, save selection for AI agents)
 *  - auto-wraps the app in <ElementSelector> in dev bundles (no app code changes)
 *
 *   module.exports = withElementSelector(config, { autoWrap: true, screenshot: true });
 */
function withElementSelector(config, options = {}) {
  if (config && typeof config.then === 'function') {
    return config.then((resolved) => withElementSelector(resolved, options));
  }
  const projectRoot = options.projectRoot || config.projectRoot || process.cwd();
  const elsel = createMiddleware({ ...options, projectRoot });
  const previous = config.server && config.server.enhanceMiddleware;

  const result = {
    ...config,
    server: {
      ...config.server,
      enhanceMiddleware: (middleware, server) => {
        const base = previous ? previous(middleware, server) : middleware;
        return (req, res, next) => elsel(req, res, () => base(req, res, next));
      },
    },
  };

  const current = config.transformer && config.transformer.babelTransformerPath;
  const upstream = current || defaultBabelTransformer(projectRoot);
  if (options.autoWrap !== false && upstream && current !== TRANSFORMER) {
    // Metro workers inherit the environment, which is how the wrapper finds
    // the transformer it delegates to (SVG, NativeWind, Sentry, ...).
    process.env.ELSEL_UPSTREAM_BABEL_TRANSFORMER = upstream;
    result.transformer = { ...config.transformer, babelTransformerPath: TRANSFORMER };
    result.cacheVersion = [config.cacheVersion, `elsel-${version}`].filter(Boolean).join(':');
  }
  return result;
}

module.exports = { withElementSelector };
