'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');
const system = require('./system');
const { version } = require('../package.json');

const PREFIX = '/__elsel/';
const MAX_BODY = 5 * 1024 * 1024;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{ projectRoot: string, screenshot?: boolean, editor?: string, log?: boolean }} options
 */
function createMiddleware(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const log = options.log === false ? () => {} : (msg) => console.log(`\x1b[36m[elsel]\x1b[0m ${msg}`);

  const routes = {
    'GET ping': async () => [200, { ok: true, version, projectRoot }],

    'POST open': async ({ file, line, column }) => {
      if (typeof file !== 'string' || !file) return [400, { ok: false, error: 'file is required' }];
      const abs = path.resolve(projectRoot, file);
      if (!fs.existsSync(abs)) return [404, { ok: false, error: `File not found: ${abs}` }];
      const result = await system.openInEditor(abs, Number(line) || 1, Number(column) || 1, options.editor);
      if (result.ok) log(`Opened ${store.relative(projectRoot, abs)}:${line}`);
      return [result.ok ? 200 : 500, result];
    },

    'POST copy': async ({ text }) => {
      if (typeof text !== 'string') return [400, { ok: false, error: 'text is required' }];
      const ok = await system.copyToClipboard(text);
      return [ok ? 200 : 500, { ok }];
    },

    'POST select': async ({ selection }) => {
      if (!selection || !selection.element) return [400, { ok: false, error: 'selection is required' }];
      const { screenshot: screenshotPath } = store.ensureDir(projectRoot);
      const screenshot = options.screenshot !== false && (await system.captureScreenshot(selection.platform, screenshotPath));
      const { record, markdownFile } = store.save(projectRoot, selection, { screenshot });
      const src = record.element.source;
      log(`Selected <${record.element.name}>${src ? ` ${src.file}:${src.line}` : ''} → ${markdownFile}`);
      return [200, { ok: true, file: markdownFile, screenshot }];
    },
  };

  return function elselMiddleware(req, res, next) {
    const url = req.url || '';
    if (!url.startsWith(PREFIX)) return next();
    const route = routes[`${req.method} ${url.slice(PREFIX.length).split('?')[0]}`];
    if (!route) return send(res, 404, { ok: false, error: 'Unknown elsel route' });

    (req.method === 'POST' ? readJson(req) : Promise.resolve({}))
      .then((body) => route(body))
      .then(([status, body]) => send(res, status, body))
      .catch((err) => send(res, 500, { ok: false, error: String((err && err.message) || err) }));
  };
}

module.exports = { createMiddleware };
