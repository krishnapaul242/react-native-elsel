import { Platform } from 'react-native';
import { currentFiber, hostDescendants, type Fiber } from './fiber';
import type { Frame } from './types';

declare const nativeFabricUIManager: any;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

function fiberOfPublicInstance(instance: any): Fiber | null {
  if (!instance || typeof instance !== 'object') return null;
  return instance.__internalInstanceHandle ?? instance._internalInstanceHandle ?? null;
}

function fiberOfDomNode(node: any): Fiber | null {
  for (let el = node; el; el = el.parentNode) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (key) return el[key];
  }
  return null;
}

/**
 * Find the deepest host fiber under (x, y), relative to `root`. Uses the same
 * renderer hook as React Native's built-in element inspector, with a direct
 * Fabric fallback.
 */
export function hitTest(root: any, x: number, y: number): Promise<Fiber | null> {
  if (Platform.OS === 'web') {
    const doc = (globalThis as any).document;
    const rect = root?.getBoundingClientRect?.();
    const el = doc?.elementFromPoint(x + (rect?.left ?? 0), y + (rect?.top ?? 0));
    const fiber = el ? fiberOfDomNode(el) : null;
    return Promise.resolve(fiber ? currentFiber(fiber) : null);
  }

  const lookup = new Promise<Fiber | null>((resolve) => {
    const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const renderers: any[] = hook?.renderers ? Array.from(hook.renderers.values()) : [];
    let pending = 0;
    for (const renderer of renderers) {
      const fn = renderer?.rendererConfig?.getInspectorDataForViewAtPoint;
      if (typeof fn !== 'function') continue;
      pending++;
      fn(root, x, y, (data: any) => {
        pending--;
        if (data && data.hierarchy?.length > 0) {
          // Prefer the touched host view; the old renderer only gives the owner.
          resolve(fiberOfPublicInstance(data.closestPublicInstance) ?? data.closestInstance ?? null);
        } else if (pending === 0) {
          resolve(null);
        }
      });
    }
    if (pending > 0) return;

    // No DevTools hook (shouldn't happen in __DEV__): ask Fabric directly.
    const rootFiber = fiberOfPublicInstance(root);
    const node = rootFiber?.stateNode?.node;
    if (typeof nativeFabricUIManager !== 'undefined' && node) {
      nativeFabricUIManager.findNodeAtPoint(node, x, y, (handle: Fiber | null) => resolve(handle ?? null));
    } else {
      resolve(null);
    }
  });
  return withTimeout(lookup, 1000, null).then((fiber) => (fiber ? currentFiber(fiber) : null));
}

function measureHost(fiber: Fiber): Promise<Frame | null> {
  const sn = fiber.stateNode;
  if (!sn) return Promise.resolve(null);
  if (Platform.OS === 'web') {
    const r = sn.getBoundingClientRect?.();
    return Promise.resolve(r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null);
  }
  return withTimeout(
    new Promise<Frame | null>((resolve) => {
      const done = (_x: number, _y: number, width: number, height: number, pageX: number, pageY: number) =>
        resolve(width || height || pageX || pageY ? { x: pageX, y: pageY, width, height } : null);
      // Fabric: canonical.publicInstance (created lazily) or the raw shadow node.
      const pub = sn.canonical?.publicInstance ?? (typeof sn.measure === 'function' ? sn : null);
      if (pub) pub.measure(done);
      else if (typeof nativeFabricUIManager !== 'undefined' && sn.node) nativeFabricUIManager.measure(sn.node, done);
      else resolve(null);
    }),
    500,
    null,
  );
}

/** Bounding box (page coordinates) of everything a fiber renders. */
export async function measureFiber(fiber: Fiber): Promise<Frame | null> {
  const frames = (await Promise.all(hostDescendants(fiber).map(measureHost))).filter(
    (f): f is Frame => f != null,
  );
  if (frames.length === 0) return null;
  const x = Math.min(...frames.map((f) => f.x));
  const y = Math.min(...frames.map((f) => f.y));
  const right = Math.max(...frames.map((f) => f.x + f.width));
  const bottom = Math.max(...frames.map((f) => f.y + f.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Page-coordinate origin of a host view we hold a ref to. */
export function measureRef(instance: any): Promise<Frame | null> {
  if (!instance) return Promise.resolve(null);
  if (Platform.OS === 'web') {
    const r = instance.getBoundingClientRect?.();
    return Promise.resolve(r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null);
  }
  return withTimeout(
    new Promise<Frame | null>((resolve) =>
      instance.measure((_x: number, _y: number, width: number, height: number, pageX: number, pageY: number) =>
        resolve({ x: pageX, y: pageY, width, height }),
      ),
    ),
    500,
    null,
  );
}
