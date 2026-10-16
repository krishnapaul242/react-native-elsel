import { StyleSheet } from 'react-native';
import { typeName } from './fiber';

const ELEMENT_TYPES = new Set([Symbol.for('react.element'), Symbol.for('react.transitional.element')]);

/** Turn arbitrary props into plain JSON that is safe to display and send. */
export function serialize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value.length > 300 ? value.slice(0, 300) + '…' : value;
  if (typeof value === 'function') return `ƒ ${value.name || 'anonymous'}()`;
  if (typeof value === 'symbol' || typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return String(value);

  const obj = value as any;
  if (ELEMENT_TYPES.has(obj.$$typeof)) return `<${typeName(obj.type)} />`;
  if (obj.__internalInstanceHandle || obj._nativeTag != null || obj.canonical) return '[HostInstance]';
  if (typeof obj.__getValue === 'function') {
    try {
      return `Animated(${JSON.stringify(serialize(obj.__getValue(), depth + 1, seen))})`;
    } catch {
      return 'Animated';
    }
  }
  if (seen.has(obj)) return '[Circular]';
  if (depth >= 4) return Array.isArray(obj) ? '[…]' : '{…}';
  seen.add(obj);

  if (Array.isArray(obj)) {
    const out = obj.slice(0, 20).map((v) => serialize(v, depth + 1, seen));
    if (obj.length > 20) out.push(`…${obj.length - 20} more`);
    return out;
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(obj);
  for (const key of keys.slice(0, 40)) out[key] = serialize(obj[key], depth + 1, seen);
  if (keys.length > 40) out['…'] = `${keys.length - 40} more keys`;
  return out;
}

export function serializeProps(props: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' && typeof value !== 'string' && typeof value !== 'number') {
      out.children = Array.isArray(value) ? `[${value.length} children]` : serialize(value);
      continue;
    }
    out[key] = serialize(value);
  }
  return out;
}

export function flattenStyle(props: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!props || props.style == null) return null;
  try {
    const flat = StyleSheet.flatten(props.style as any);
    return flat ? (serialize(flat) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Compact one-line rendering for the panel. */
export function preview(value: unknown, max = 120): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > max ? text.slice(0, max) + '…' : text;
}
