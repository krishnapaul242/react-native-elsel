import { Platform, StyleSheet } from 'react-native';
import { currentFiber, HostComponent, hostDescendants, type Fiber } from './fiber';
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

const HostText = 6;
const Offscreen = 22;
const MAX_VISITED = 8000;

// Fabric's measure() answers synchronously from the shadow tree.
function measureSync(fiber: Fiber): Frame | null {
  const node = fiber.stateNode?.node;
  if (!node) return null;
  let frame: Frame | null = null;
  nativeFabricUIManager.measure(node, (_x: number, _y: number, width: number, height: number, pageX: number, pageY: number) => {
    frame = { x: pageX, y: pageY, width, height };
  });
  return frame;
}

/**
 * Walk the app's host views the way a real touch is routed: later siblings
 * paint on top, and views that can't receive touches are skipped along with
 * their children (display none, opacity 0, pointerEvents none, inactive
 * react-native-screens screens, hidden Activity/Suspense trees, and anything
 * clipped away by overflow: hidden). Fabric's findNodeAtPoint only compares
 * layout boxes, so it happily returns invisible overlays and screens that are
 * mounted but not shown.
 */
function hitTestTree(root: any, x: number, y: number): Fiber | null {
  if (typeof nativeFabricUIManager === 'undefined' || typeof nativeFabricUIManager.measure !== 'function') return null;
  const handle = fiberOfPublicInstance(root);
  if (!handle) return null;
  const rootFiber = currentFiber(handle);
  const origin = measureSync(rootFiber);
  if (!origin) return null;
  const px = x + origin.x;
  const py = y + origin.y;
  let best: Fiber | null = null;
  let visited = 0;

  const visit = (fiber: Fiber | null) => {
    for (let node = fiber; node && visited < MAX_VISITED; node = node.sibling) {
      visited++;
      if (node.tag === HostText) continue;
      if (node.tag === Offscreen && (node.memoizedProps as any)?.mode === 'hidden') continue;
      if (node.tag !== HostComponent) {
        visit(node.child);
        continue;
      }
      const props: any = node.memoizedProps ?? {};
      const style: any = StyleSheet.flatten(props.style) ?? {};
      const pointerEvents = props.pointerEvents ?? style.pointerEvents;
      if (style.display === 'none' || style.opacity === 0 || pointerEvents === 'none') continue;
      if (props.activityState === 0) continue; // react-native-screens: inactive screen
      const frame = measureSync(node);
      const inside =
        frame != null && px >= frame.x && px <= frame.x + frame.width && py >= frame.y && py <= frame.y + frame.height;
      const clips = style.overflow === 'hidden' || style.overflow === 'scroll' || /ScrollView$/.test(String(node.type));
      if (!inside && clips) continue;
      if (inside && pointerEvents !== 'box-none') best = node;
      if (pointerEvents !== 'box-only') visit(node.child);
    }
  };
  visit(rootFiber.child);
  return best;
}

/**
 * Find the deepest host fiber under (x, y), relative to `root`. On Fabric this
 * walks the view tree itself (see hitTestTree); otherwise it uses the same
 * renderer hook as React Native's built-in element inspector.
 */
export function hitTest(root: any, x: number, y: number): Promise<Fiber | null> {
  if (Platform.OS !== 'web') {
    try {
      const found = hitTestTree(root, x, y);
      if (found) return Promise.resolve(currentFiber(found));
    } catch {}
  }
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
