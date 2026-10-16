'use strict';

// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0) exposing the
// element selected in the app. stdout carries protocol messages only.

const fs = require('fs');
const readline = require('readline');
const store = require('./store');
const { version } = require('../package.json');

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const NO_SELECTION =
  'No element has been sent yet. In the running app, right-click or long-press an element (or use "Inspect Element (elsel)" in the Dev Menu), then tap "Send to AI".';

const TOOLS = [
  {
    name: 'get_selected_element',
    description:
      'Get the UI element the developer most recently selected in their running React Native app: component name, source file:line, code snippet, props, flattened style, on-screen frame, ancestor components and (when available) a screenshot with the element outlined. Use this when the user refers to "this element", "the selected component", or asks to change something they pointed at in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        include_screenshot: { type: 'boolean', description: 'Attach the simulator/emulator screenshot. Default true.' },
      },
    },
  },
  {
    name: 'wait_for_selection',
    description:
      'Wait for the developer to select an element in the running app and tap "Send to AI", then return it like get_selected_element. Use when you ask the user to point at something in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_seconds: { type: 'number', description: 'How long to wait. Default 120, max 600.' },
        include_screenshot: { type: 'boolean', description: 'Attach the screenshot. Default true.' },
      },
    },
  },
  {
    name: 'list_recent_selections',
    description: 'List recently selected elements (newest first) with their source locations.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Default 10, max 50.' } },
    },
  },
];

function selectionContent(projectRoot, includeScreenshot) {
  const latest = store.readLatest(projectRoot);
  if (!latest) return [{ type: 'text', text: NO_SELECTION }];
  const content = [{ type: 'text', text: latest.markdown }];
  if (includeScreenshot !== false && latest.screenshot) {
    content.push({ type: 'image', data: fs.readFileSync(latest.screenshot).toString('base64'), mimeType: 'image/png' });
  }
  return content;
}

async function callTool(projectRoot, name, args = {}) {
  switch (name) {
    case 'get_selected_element':
      return { content: selectionContent(projectRoot, args.include_screenshot) };

    case 'wait_for_selection': {
      const timeout = Math.min(Math.max(Number(args.timeout_seconds) || 120, 1), 600) * 1000;
      const before = store.readLatest(projectRoot);
      const since = before ? before.mtimeMs : 0;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        let latest = null;
        try {
          latest = store.readLatest(projectRoot);
        } catch {} // file mid-write
        if (latest && latest.mtimeMs > since) return { content: selectionContent(projectRoot, args.include_screenshot) };
      }
      return { content: [{ type: 'text', text: `No new selection within ${timeout / 1000}s.` }], isError: true };
    }

    case 'list_recent_selections': {
      const items = store.readHistory(projectRoot, Math.min(Number(args.limit) || 10, 50));
      if (!items.length) return { content: [{ type: 'text', text: NO_SELECTION }] };
      const text = items
        .map((h, i) => `${i + 1}. <${h.name}> ${h.source ? `${h.source.file}:${h.source.line}:${h.source.column}` : '(unknown source)'} — ${h.platform}, ${h.timestamp}`)
        .join('\n');
      return { content: [{ type: 'text', text }] };
    }

    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

function startMcpServer(projectRoot, { input = process.stdin, output = process.stdout } = {}) {
  const write = (msg) => output.write(JSON.stringify(msg) + '\n');
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(msg) {
    const { id, method, params = {} } = msg;
    const isRequest = id !== undefined && id !== null;
    try {
      switch (method) {
        case 'initialize':
          return reply(id, {
            protocolVersion: SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'elsel', version },
            instructions:
              'elsel exposes the UI element the developer selected in their running React Native app. Call get_selected_element when they refer to something they pointed at in the app.',
          });
        case 'ping':
          return reply(id, {});
        case 'tools/list':
          return reply(id, { tools: TOOLS });
        case 'tools/call':
          return reply(id, await callTool(projectRoot, params.name, params.arguments));
        default:
          if (isRequest) fail(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      if (isRequest) fail(id, err.code || -32603, err.message || String(err));
    }
  }

  const rl = readline.createInterface({ input });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return fail(null, -32700, 'Parse error');
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
  });
  return rl;
}

module.exports = { startMcpServer, callTool, TOOLS };
