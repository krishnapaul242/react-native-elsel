import { postJson } from './devServer';
import type { Fiber } from './fiber';
import type { SourceLocation } from './types';

type RawFrame = { methodName: string; file: string; lineNumber: number; column: number };

// Frames inside React itself (jsxDEV, createElement, ...) are never the
// place the element was written. Neither are custom JSX runtimes that wrap
// React's (jsxImportSource): NativeWind / react-native-css-interop, Emotion,
// theme-ui and friends would otherwise claim every element in the app.
const REACT_INTERNAL =
  /node_modules[\\/](react|react-dom)[\\/]|jsx-(dev-)?runtime|react-native-css-interop[\\/].*[\\/]wrap-jsx|Libraries[\\/]Renderer[\\/]/;

const V8_HERMES = /^\s*at (?:(.+?) \()?(?:address at )?(.+?):(\d+):(\d+)\)?\s*$/;
const JSC_FIREFOX = /^(?:(.*?)@)?(.+?):(\d+):(\d+)$/;

export function parseStack(stack: string, max = 10): RawFrame[] {
  const frames: RawFrame[] = [];
  for (const line of stack.split('\n')) {
    const m = line.match(V8_HERMES) ?? line.trim().match(JSC_FIREFOX);
    if (!m) continue;
    frames.push({
      methodName: m[1] || '<anonymous>',
      file: m[2],
      lineNumber: Number(m[3]),
      column: Number(m[4]),
    });
    if (frames.length >= max) break;
  }
  return frames;
}

function stackOf(fiber: Fiber): string | null {
  const s = fiber._debugStack;
  if (!s) return null;
  if (typeof s === 'string') return s;
  return typeof s.stack === 'string' ? s.stack : null;
}

const cache = new Map<string, RawFrame>();
const keyOf = (f: RawFrame) => `${f.file}:${f.lineNumber}:${f.column}`;

async function symbolicate(frames: RawFrame[]): Promise<void> {
  const todo = frames.filter((f) => !cache.has(keyOf(f)));
  if (todo.length === 0) return;
  try {
    const { data } = await postJson<{ stack?: RawFrame[] }>('/symbolicate', { stack: todo });
    data?.stack?.forEach((f, i) => cache.set(keyOf(todo[i]), f));
  } catch {
    // Metro unreachable: leave frames unresolved.
  }
}

function toLocation(file: string, line: number, column: number): SourceLocation {
  return { file, line, column, isLibrary: /node_modules[\\/]/.test(file) };
}

/**
 * Resolve where each fiber's JSX element was written. React 18 exposes
 * `_debugSource` directly; React 19 only keeps a stack, which Metro maps back
 * to the original file via its /symbolicate endpoint.
 */
export async function resolveSources(fibers: Fiber[]): Promise<(SourceLocation | null)[]> {
  const stacks = fibers.map((f) => {
    if (f._debugSource) return null;
    const s = stackOf(f);
    return s ? parseStack(s) : null;
  });
  await symbolicate(stacks.flatMap((s) => s ?? []));

  return fibers.map((fiber, i) => {
    const ds = fiber._debugSource;
    if (ds) return toLocation(ds.fileName, ds.lineNumber, ds.columnNumber ?? 1);
    for (const raw of stacks[i] ?? []) {
      const f = cache.get(keyOf(raw));
      if (!f || !f.file || /^https?:/.test(f.file) || REACT_INTERNAL.test(f.file)) continue;
      // Metro columns are 0-based.
      return toLocation(f.file, f.lineNumber, (f.column ?? 0) + 1);
    }
    return null;
  });
}
