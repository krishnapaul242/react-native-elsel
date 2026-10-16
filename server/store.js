'use strict';

const fs = require('fs');
const path = require('path');

const DIR = '.elsel';
const HISTORY_LIMIT = 50;

function paths(projectRoot) {
  const dir = path.join(projectRoot, DIR);
  return {
    dir,
    json: path.join(dir, 'selection.json'),
    markdown: path.join(dir, 'selection.md'),
    screenshot: path.join(dir, 'selection.png'),
    history: path.join(dir, 'history.jsonl'),
  };
}

function ensureDir(projectRoot) {
  const p = paths(projectRoot);
  fs.mkdirSync(p.dir, { recursive: true });
  const ignore = path.join(p.dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  return p;
}

function relative(projectRoot, file) {
  if (!file) return file;
  const abs = path.resolve(projectRoot, file);
  const rel = path.relative(projectRoot, abs);
  return rel.startsWith('..') ? abs : rel;
}

function codeSnippet(projectRoot, source, radius = 6) {
  if (!source || !source.file) return null;
  try {
    const lines = fs.readFileSync(path.resolve(projectRoot, source.file), 'utf8').split('\n');
    const start = Math.max(0, source.line - 1 - radius);
    const end = Math.min(lines.length, source.line + radius);
    const width = String(end).length;
    return lines
      .slice(start, end)
      .map((text, i) => {
        const n = start + i + 1;
        return `${n === source.line ? '>' : ' '} ${String(n).padStart(width)} | ${text}`;
      })
      .join('\n');
  } catch {
    return null;
  }
}

function withRelativeSource(projectRoot, entry) {
  if (!entry.source) return entry;
  return { ...entry, source: { ...entry.source, file: relative(projectRoot, entry.source.file), absoluteFile: path.resolve(projectRoot, entry.source.file) } };
}

/** Normalise what the app sent: project-relative paths plus a code snippet. */
function enrich(projectRoot, selection) {
  const element = withRelativeSource(projectRoot, selection.element);
  return {
    ...selection,
    element,
    chain: (selection.chain || []).map((c) => withRelativeSource(projectRoot, c)),
    code: codeSnippet(projectRoot, element.source && { ...element.source, file: element.source.absoluteFile }),
  };
}

const loc = (s) => (s ? `${s.file}:${s.line}:${s.column}` : 'unknown');
const fence = (lang, body) => '```' + lang + '\n' + body + '\n```';
const ext = (file) => (path.extname(file || '').slice(1) || 'tsx').replace(/^m?js$/, 'jsx');

function toMarkdown(sel, { screenshotFile } = {}) {
  const { element } = sel;
  const userChain = sel.chain.filter((c) => c.source && !c.source.isLibrary);
  const lines = [
    `# Selected element: <${element.name}>`,
    '',
    `- **Source:** \`${loc(element.source)}\`${element.source && element.source.isLibrary ? ' (library)' : ''}`,
    `- **Component path:** ${(userChain.length ? userChain : sel.chain).map((c) => c.name).join(' › ')}`,
    `- **Platform:** ${sel.platform}, window ${sel.window.width}×${sel.window.height}`,
  ];
  if (element.frame) {
    const f = element.frame;
    lines.push(`- **On screen:** x=${Math.round(f.x)}, y=${Math.round(f.y)}, ${Math.round(f.width)}×${Math.round(f.height)}`);
  }
  if (screenshotFile) lines.push(`- **Screenshot:** \`${screenshotFile}\` (selected element is outlined in blue)`);
  lines.push(`- **Selected at:** ${sel.timestamp}`);

  if (sel.code) lines.push('', '## Code', '', fence(ext(element.source.file), sel.code));
  if (element.style && Object.keys(element.style).length) {
    lines.push('', '## Style (flattened)', '', fence('json', JSON.stringify(element.style, null, 2)));
  }
  const props = Object.fromEntries(Object.entries(element.props || {}).filter(([k]) => k !== 'style'));
  lines.push('', '## Props', '', fence('json', JSON.stringify(props, null, 2)));

  if (userChain.length) {
    lines.push('', '## Ancestors (your code, outermost first)', '');
    for (const c of userChain) lines.push(`- \`<${c.name}>\` — \`${loc(c.source)}\``);
  }
  return lines.join('\n') + '\n';
}

function save(projectRoot, selection, { screenshot = false } = {}) {
  const p = ensureDir(projectRoot);
  const enriched = enrich(projectRoot, selection);
  const screenshotFile = screenshot ? path.relative(projectRoot, p.screenshot) : null;
  if (!screenshot && fs.existsSync(p.screenshot)) fs.rmSync(p.screenshot);
  const record = { ...enriched, screenshot: screenshotFile };

  fs.writeFileSync(p.json, JSON.stringify(record, null, 2));
  fs.writeFileSync(p.markdown, toMarkdown(record, { screenshotFile }));

  const history = fs.existsSync(p.history) ? fs.readFileSync(p.history, 'utf8').split('\n').filter(Boolean) : [];
  history.push(JSON.stringify({ timestamp: record.timestamp, name: record.element.name, source: record.element.source, platform: record.platform }));
  fs.writeFileSync(p.history, history.slice(-HISTORY_LIMIT).join('\n') + '\n');

  return { record, markdownFile: path.relative(projectRoot, p.markdown) };
}

function readLatest(projectRoot) {
  const p = paths(projectRoot);
  if (!fs.existsSync(p.json)) return null;
  const record = JSON.parse(fs.readFileSync(p.json, 'utf8'));
  return {
    record,
    markdown: fs.existsSync(p.markdown) ? fs.readFileSync(p.markdown, 'utf8') : toMarkdown(record),
    screenshot: record.screenshot && fs.existsSync(p.screenshot) ? p.screenshot : null,
    mtimeMs: fs.statSync(p.json).mtimeMs,
  };
}

function readHistory(projectRoot, limit = 10) {
  const p = paths(projectRoot);
  if (!fs.existsSync(p.history)) return [];
  return fs
    .readFileSync(p.history, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = { paths, ensureDir, save, readLatest, readHistory, toMarkdown, relative };
