// Minimal view of React's internal Fiber shape. These are private React
// internals, read-only, and only touched in development builds.
export type Fiber = {
  tag: number;
  type: unknown;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  memoizedProps: Record<string, unknown> | null;
  stateNode: any;
  // React 19+: Error captured where the JSX element was created.
  _debugStack?: { stack?: string } | string | null;
  // React <= 18: injected by @babel/plugin-transform-react-jsx-source.
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number } | null;
};

const FunctionComponent = 0;
const ClassComponent = 1;
const HostRoot = 3;
export const HostComponent = 5;
const ForwardRef = 11;
const MemoComponent = 14;
const SimpleMemoComponent = 15;

const COMPOSITE_TAGS = new Set([
  FunctionComponent,
  ClassComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
]);

export function isComposite(fiber: Fiber): boolean {
  return COMPOSITE_TAGS.has(fiber.tag);
}

export function typeName(type: any): string {
  if (type == null) return 'Anonymous';
  if (typeof type === 'string') return type;
  if (typeof type === 'function') return type.displayName || type.name || 'Anonymous';
  if (typeof type === 'object') {
    if (typeof type.displayName === 'string') return type.displayName;
    if (type.render) return typeName(type.render); // forwardRef
    if (type.type) return typeName(type.type); // memo
  }
  return 'Anonymous';
}

/** Best-effort pick of the committed fiber (vs. its work-in-progress twin). */
export function currentFiber(fiber: Fiber): Fiber {
  let node = fiber;
  while (node.return) node = node.return;
  if (node.tag === HostRoot && node.stateNode && node.stateNode.current !== node && fiber.alternate) {
    return fiber.alternate;
  }
  return fiber;
}

/** Touched host fiber plus every composite ancestor, ordered leaf -> root. */
export function ancestorChain(leaf: Fiber, limit = 120): Fiber[] {
  const chain: Fiber[] = [leaf];
  let node = leaf.return;
  while (node && chain.length < limit) {
    if (isComposite(node)) chain.push(node);
    node = node.return;
  }
  return chain;
}

/** Outermost host descendants of a fiber, i.e. the native views it renders. */
export function hostDescendants(fiber: Fiber, limit = 50): Fiber[] {
  if (fiber.tag === HostComponent) return [fiber];
  const out: Fiber[] = [];
  const visit = (node: Fiber | null) => {
    while (node && out.length < limit) {
      if (node.tag === HostComponent) out.push(node);
      else visit(node.child);
      node = node.sibling;
    }
  };
  visit(fiber.child);
  return out;
}
