import React, { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Alert,
  DevSettings,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type PointerEvent,
} from 'react-native';
import { devServerUrl, postJson, serverInfo, setDevServerUrl } from './devServer';
import { ancestorChain, isComposite, typeName, type Fiber } from './fiber';
import { hitTest, measureFiber, measureRef } from './inspect';
import { flattenStyle, serializeProps } from './serialize';
import { resolveSources } from './source';
import type { ChainEntry, Frame, Selection } from './types';
import { Highlight } from './ui/Highlight';
import { Panel, type Crumb } from './ui/Panel';
import { colors } from './ui/theme';

export type LongPressOptions = { duration?: number; touches?: number };

export type ElementSelectorProps = {
  children: React.ReactNode;
  /** Defaults to `__DEV__`. When false, children render untouched. */
  enabled?: boolean;
  /** Secondary-button pointer events (mouse right-click). Default true. */
  rightClick?: boolean;
  /** Press-and-hold to inspect. Default `{ duration: 600, touches: 1 }`. */
  longPress?: boolean | LongPressOptions;
  /** Add "Inspect Element (elsel)" to the React Native Dev Menu. Default true. */
  devMenu?: boolean;
  /** Override the Metro URL (normally read from the bundle URL). */
  devServerUrl?: string;
  /** Called whenever an element is selected. */
  onSelect?: (selection: Selection) => void;
};

export type ElementSelectorHandle = {
  /** Inspect the element at window coordinates. */
  inspectAt: (x: number, y: number) => Promise<void>;
  /** Enter pick mode: the next tap selects an element. */
  pick: () => void;
  close: () => void;
};

type Entry = ChainEntry & { fiber: Fiber };
type Inspection = { entries: Entry[]; selected: number; frame: Frame | null };
type Mode = 'idle' | 'picking' | 'inspecting';

const MOVE_TOLERANCE = 10;

let devMenuHandler: (() => void) | null = null;
let devMenuRegistered = false;

// Lets a manually placed <ElementSelector> take over from the auto-wrapped one
// at the app root, so there's never two of them listening.
const OuterSelector = createContext<{ defer: () => () => void } | null>(null);

export const ElementSelector = forwardRef<ElementSelectorHandle, ElementSelectorProps>(function ElementSelector(
  { enabled = typeof __DEV__ !== 'undefined' && __DEV__, children, ...rest },
  ref,
) {
  const outer = useContext(OuterSelector);
  useEffect(() => (enabled && outer ? outer.defer() : undefined), [enabled, outer]);
  if (!enabled) return <>{children}</>;
  return (
    <Selector ref={ref} {...rest}>
      {children}
    </Selector>
  );
});

const Selector = forwardRef<ElementSelectorHandle, Omit<ElementSelectorProps, 'enabled'>>(function Selector(
  { children, rightClick = true, longPress = true, devMenu = true, devServerUrl: serverUrl, onSelect },
  ref,
) {
  const window = useWindowDimensions();
  const wrapperRef = useRef<React.ComponentRef<typeof View>>(null);
  const appRef = useRef<React.ComponentRef<typeof View>>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [showLibraries, setShowLibraries] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState<string | undefined>();
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [deferrals, setDeferrals] = useState(0);
  const active = deferrals === 0;
  const outerContext = useMemo(
    () => ({
      defer: () => {
        setDeferrals((n) => n + 1);
        return () => setDeferrals((n) => n - 1);
      },
    }),
    [],
  );

  useEffect(() => setDevServerUrl(serverUrl), [serverUrl]);

  const flash = useCallback((message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3500);
  }, []);

  const buildSelection = useCallback(
    (insp: Inspection): Selection => {
      const entry = insp.entries[insp.selected];
      const props = entry.fiber.memoizedProps;
      return {
        element: {
          name: entry.name,
          kind: entry.kind,
          source: entry.source,
          props: serializeProps(props),
          style: flattenStyle(props),
          frame: insp.frame,
        },
        chain: insp.entries
          .slice(0, 60)
          .map(({ name, kind, source }) => ({ name, kind, source }))
          .reverse(),
        platform: Platform.OS,
        window: { width: window.width, height: window.height },
        timestamp: new Date().toISOString(),
      };
    },
    [window.width, window.height],
  );

  const inspectAt = useCallback(
    async (pageX: number, pageY: number) => {
      const [appOrigin, wrapperOrigin] = await Promise.all([measureRef(appRef.current), measureRef(wrapperRef.current)]);
      const leaf = await hitTest(appRef.current, pageX - (appOrigin?.x ?? 0), pageY - (appOrigin?.y ?? 0));
      if (!leaf) {
        flash('No element found at that point');
        return;
      }
      // Stop at our own wrapper so it never shows up in the component path.
      const fibers = ancestorChain(leaf);
      const own = fibers.findIndex((f) => f.type === ElementSelector || f.type === Selector);
      if (own !== -1) fibers.length = own;
      const [sources, info] = await Promise.all([resolveSources(fibers), serverInfo()]);
      setProjectRoot(info?.projectRoot);

      const entries: Entry[] = [];
      fibers.forEach((fiber, i) => {
        const entry: Entry = { fiber, name: typeName(fiber.type), kind: isComposite(fiber) ? 'composite' : 'host', source: sources[i] };
        const prev = entries[entries.length - 1];
        // memo()/forwardRef wrappers show up twice with the same name and call site.
        if (prev && prev.name === entry.name && prev.source?.file === entry.source?.file && prev.source?.line === entry.source?.line) return;
        entries.push(entry);
      });
      const firstUser = entries.findIndex((e) => e.source && !e.source.isLibrary);
      const selected = firstUser === -1 ? 0 : firstUser;
      const frame = await measureFiber(entries[selected].fiber);
      const next = { entries, selected, frame };
      setOrigin({ x: wrapperOrigin?.x ?? 0, y: wrapperOrigin?.y ?? 0 });
      setInspection(next);
      setPanelHidden(false);
      setMode('inspecting');
      onSelectRef.current?.(buildSelection(next));
    },
    [buildSelection, flash],
  );

  const close = useCallback(() => {
    setMode('idle');
    setInspection(null);
  }, []);

  const handle = useMemo<ElementSelectorHandle>(() => ({ inspectAt, pick: () => setMode('picking'), close }), [inspectAt, close]);
  useImperativeHandle(ref, () => handle, [handle]);

  // Global handle for automation (Maestro, e2e, agents) — dev only, active selector only.
  useEffect(() => {
    if (!active) return;
    const g = globalThis as any;
    g.__ELSEL__ = handle;
    return () => {
      if (g.__ELSEL__ === handle) delete g.__ELSEL__;
    };
  }, [active, handle]);

  // Dev Menu entry. DevSettings has no remove API, so register once per JS runtime.
  useEffect(() => {
    if (!devMenu || !active) return;
    devMenuHandler = () => setMode('picking');
    if (!devMenuRegistered && typeof DevSettings?.addMenuItem === 'function') {
      DevSettings.addMenuItem('Inspect Element (elsel)', () => devMenuHandler?.());
      devMenuRegistered = true;
    }
    return () => {
      devMenuHandler = null;
    };
  }, [devMenu, active]);

  // Web: intercept the browser context menu (hold Shift to get the native one).
  useEffect(() => {
    if (Platform.OS !== 'web' || !rightClick || !active) return;
    const doc = (globalThis as any).document;
    const handler = (e: any) => {
      const root: any = appRef.current;
      if (e.shiftKey || !root?.contains?.(e.target)) return;
      e.preventDefault();
      inspectAt(e.clientX, e.clientY);
    };
    doc?.addEventListener('contextmenu', handler, true);
    return () => doc?.removeEventListener('contextmenu', handler, true);
  }, [rightClick, active, inspectAt]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      const ev = e.nativeEvent;
      if (Platform.OS === 'web' || ev.button !== 2) return;
      inspectAt((ev as any).pageX ?? ev.x, (ev as any).pageY ?? ev.y);
    },
    [inspectAt],
  );

  // Long press, observed without becoming the responder so the app's own
  // touch handling keeps working.
  const lp = longPress === false || !active ? null : { duration: 600, touches: 1, ...(longPress === true ? {} : longPress) };
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const cancelPress = useCallback(() => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  const onTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      cancelPress();
      if (!lp || e.nativeEvent.touches.length !== lp.touches) return;
      const { pageX, pageY } = e.nativeEvent;
      press.current = {
        x: pageX,
        y: pageY,
        timer: setTimeout(() => {
          press.current = null;
          inspectAt(pageX, pageY);
        }, lp.duration),
      };
    },
    [lp?.duration, lp?.touches, inspectAt, cancelPress],
  );
  const onTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.nativeEvent.pageX - p.x, e.nativeEvent.pageY - p.y) > MOVE_TOLERANCE) cancelPress();
    },
    [cancelPress],
  );
  useEffect(() => cancelPress, [cancelPress]);

  const selectCrumb = useCallback(
    async (index: number) => {
      if (!inspection) return;
      const frame = await measureFiber(inspection.entries[index].fiber);
      const next = { ...inspection, selected: index, frame };
      setInspection(next);
      onSelectRef.current?.(buildSelection(next));
    },
    [inspection, buildSelection],
  );

  const formatPath = useCallback(
    (file: string) => {
      if (projectRoot && file.startsWith(projectRoot + '/')) return file.slice(projectRoot.length + 1);
      const nm = file.lastIndexOf('node_modules/');
      if (nm !== -1) return file.slice(nm);
      return file.split('/').slice(-3).join('/');
    },
    [projectRoot],
  );

  const selection = useMemo(() => (inspection ? buildSelection(inspection) : null), [inspection, buildSelection]);

  const crumbs: Crumb[] = useMemo(() => {
    if (!inspection) return [];
    return inspection.entries
      .map((e, index) => ({ name: e.name, kind: e.kind, source: e.source, index }))
      .filter((c) => showLibraries || c.index === 0 || c.index === inspection.selected || (c.source && !c.source.isLibrary))
      .reverse();
  }, [inspection, showLibraries]);

  const open = useCallback(async () => {
    const src = selection?.element.source;
    if (!src) return;
    try {
      const res = await postJson('/__elsel/open', { file: src.file, line: src.line, column: src.column });
      if (res.status === 404) await postJson('/open-stack-frame', { file: src.file, lineNumber: src.line });
      flash(`Opened ${formatPath(src.file)}:${src.line}`);
    } catch {
      flash(`Could not reach Metro at ${devServerUrl()}`);
    }
  }, [selection, flash, formatPath]);

  const copy = useCallback(async () => {
    if (!selection) return;
    const text = clipboardText(selection, formatPath);
    try {
      const res = await postJson('/__elsel/copy', { text });
      if (res.status === 200) return flash('Copied to your computer’s clipboard');
    } catch {}
    Alert.alert('Element', text);
  }, [selection, flash, formatPath]);

  const send = useCallback(async () => {
    if (!selection) return;
    setPanelHidden(true); // keep the panel out of the screenshot
    await new Promise<void>((r) => setTimeout(r, 250));
    try {
      const res = await postJson<{ file?: string; screenshot?: boolean }>('/__elsel/select', { selection });
      if (res.status === 404) flash('Add withElementSelector() to metro.config.js to enable this');
      else if (res.status !== 200) flash('Metro could not save the selection');
      else flash(`Saved to ${res.data?.file ?? '.elsel/selection.md'}${res.data?.screenshot ? ' with screenshot' : ''}`);
    } catch {
      flash(`Could not reach Metro at ${devServerUrl()}`);
    }
    setPanelHidden(false);
  }, [selection, flash]);

  const frame = inspection?.frame;
  const placement = frame && frame.y + frame.height / 2 - origin.y > window.height / 2 ? 'top' : 'bottom';

  return (
    <OuterSelector.Provider value={outerContext}>
      <View ref={wrapperRef} style={styles.fill} collapsable={false}>
        <View
          ref={appRef}
          style={styles.fill}
          collapsable={false}
          onPointerDown={rightClick && active ? onPointerDown : undefined}
          onTouchStart={lp ? onTouchStart : undefined}
          onTouchMove={lp ? onTouchMove : undefined}
          onTouchEnd={lp ? cancelPress : undefined}
          onTouchCancel={lp ? cancelPress : undefined}
        >
          {children}
        </View>

        {active && mode === 'inspecting' && inspection && selection && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {frame && <Highlight frame={{ ...frame, x: frame.x - origin.x, y: frame.y - origin.y }} label={selection.element.name} />}
            {!panelHidden && (
              <Panel
                element={selection.element}
                crumbs={crumbs}
                selectedIndex={inspection.selected}
                showLibraries={showLibraries}
                placement={placement}
                maxHeight={window.height * 0.48}
                status={status}
                formatPath={formatPath}
                onSelectCrumb={selectCrumb}
                onToggleLibraries={() => setShowLibraries((v) => !v)}
                onOpen={open}
                onCopy={copy}
                onSend={send}
                onPick={() => setMode('picking')}
                onClose={close}
              />
            )}
          </View>
        )}

        {active && mode === 'picking' && (
          <View
            style={StyleSheet.absoluteFill}
            onStartShouldSetResponder={() => true}
            onResponderRelease={(e) => inspectAt(e.nativeEvent.pageX, e.nativeEvent.pageY)}
          >
            <View style={styles.pickBanner} pointerEvents="box-none">
              <Text style={styles.pickText}>Tap an element to inspect</Text>
              <Pressable onPress={() => setMode(inspection ? 'inspecting' : 'idle')} hitSlop={8}>
                <Text style={styles.pickCancel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}

        {mode !== 'inspecting' && status && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.pickText}>{status}</Text>
          </View>
        )}
      </View>
    </OuterSelector.Provider>
  );
});

function clipboardText(selection: Selection, formatPath: (file: string) => string): string {
  const { element } = selection;
  const loc = (s: ChainEntry['source']) => (s ? `${formatPath(s.file)}:${s.line}:${s.column}` : 'unknown source');
  const path = selection.chain
    .filter((c) => c.source && !c.source.isLibrary)
    .map((c) => c.name)
    .join(' › ');
  const props = Object.fromEntries(Object.entries(element.props).filter(([k]) => k !== 'style'));
  return [
    `<${element.name}> ${loc(element.source)}`,
    path && `Path: ${path}`,
    Object.keys(props).length > 0 && `Props: ${JSON.stringify(props)}`,
    element.style && `Style: ${JSON.stringify(element.style)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pickBanner: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  pickText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pickCancel: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  toast: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: colors.panel,
  },
});
