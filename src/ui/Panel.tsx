import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { preview } from '../serialize';
import type { ChainEntry, SelectedElement } from '../types';
import { colors, mono } from './theme';

export type Crumb = ChainEntry & { index: number };

type Props = {
  element: SelectedElement;
  crumbs: Crumb[]; // root -> leaf
  selectedIndex: number;
  parentIndex?: number;
  childIndex?: number;
  showLibraries: boolean;
  placement: 'top' | 'bottom';
  maxHeight: number;
  status: string | null;
  formatPath: (file: string) => string;
  onSelectCrumb: (index: number) => void;
  onToggleLibraries: () => void;
  onOpen: () => void;
  onCopy: () => void;
  onSend: () => void;
  onPick: () => void;
  onClose: () => void;
};

export function Panel(props: Props) {
  const { element, crumbs, selectedIndex, parentIndex, childIndex, placement } = props;
  const crumbScroll = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const source = element.source;
  const styleEntries = Object.entries(element.style ?? {});
  const propEntries = Object.entries(element.props).filter(([k]) => k !== 'style');

  return (
    <View
      style={[styles.panel, placement === 'top' ? styles.top : styles.bottom, { maxHeight: props.maxHeight }]}
    >
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          <Text style={styles.bracket}>{'<'}</Text>
          {element.name}
          <Text style={styles.bracket}>{'>'}</Text>
        </Text>
        <Chip label="↑ Parent" onPress={() => parentIndex !== undefined && props.onSelectCrumb(parentIndex)} disabled={parentIndex === undefined} />
        <Chip label="↓ Child" onPress={() => childIndex !== undefined && props.onSelectCrumb(childIndex)} disabled={childIndex === undefined} />
        <Chip label={props.showLibraries ? 'libs on' : 'libs off'} onPress={props.onToggleLibraries} active={props.showLibraries} />
        <Pressable onPress={props.onClose} hitSlop={10} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {source ? (
        <Pressable onPress={props.onOpen}>
          <Text style={[styles.path, source.isLibrary && { color: colors.library }]} numberOfLines={1}>
            {props.formatPath(source.file)}:{source.line}:{source.column}
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.path, { color: colors.muted }]}>source unknown</Text>
      )}

      <ScrollView
        ref={crumbScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.crumbs}
        contentContainerStyle={styles.crumbsContent}
        onContentSizeChange={() => crumbScroll.current?.scrollToEnd({ animated: false })}
      >
        {crumbs.map((c, i) => (
          <View key={c.index} style={styles.crumbRow}>
            {i > 0 && <Text style={styles.sep}>›</Text>}
            <Pressable onPress={() => props.onSelectCrumb(c.index)} style={[styles.crumb, c.index === selectedIndex && styles.crumbActive]}>
              <Text style={[styles.crumbText, (!c.source || c.source.isLibrary) && { color: colors.library }, c.index === selectedIndex && { color: '#fff' }]}>
                {c.name}
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <View style={styles.actions}>
        <Action label="Open" onPress={props.onOpen} disabled={!source} />
        <Action label="Copy" onPress={props.onCopy} />
        <Action label="Send to AI" onPress={props.onSend} primary />
        <Action label="Pick" onPress={props.onPick} />
      </View>
      {props.status ? <Text style={styles.status}>{props.status}</Text> : null}

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 8 }}>
        {element.frame && (
          <Section title="Layout">
            <Row k="position" v={`x ${round(element.frame.x)}  y ${round(element.frame.y)}`} />
            <Row k="size" v={`${round(element.frame.width)} × ${round(element.frame.height)}`} />
          </Section>
        )}
        {styleEntries.length > 0 && (
          <Section title="Style">
            {styleEntries.map(([k, v]) => (
              <Row key={k} k={k} v={preview(v)} value={v} />
            ))}
          </Section>
        )}
        <Section title="Props">
          {propEntries.length === 0 ? (
            <Text style={styles.empty}>none</Text>
          ) : (
            propEntries.map(([k, v]) => <Row key={k} k={k} v={preview(v)} value={v} />)
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ k, v, value }: { k: string; v: string; value?: unknown }) {
  const color =
    typeof value === 'number' ? colors.number : typeof value === 'string' && !value.startsWith('ƒ') ? colors.string : colors.text;
  return (
    <View style={styles.row}>
      <Text style={styles.key}>{k}</Text>
      <Text style={[styles.value, { color }]} selectable>
        {v}
      </Text>
    </View>
  );
}

function Action({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}
    >
      <Text style={[styles.actionText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, onPress, active, disabled }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[styles.chip, active && { borderColor: colors.accent }, disabled && { opacity: 0.35 }]}
    >
      <Text style={[styles.chipText, active && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.panelBorder,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 24,
  },
  top: { top: 48 },
  bottom: { bottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.component, fontSize: 16, fontWeight: '700', fontFamily: mono },
  bracket: { color: colors.muted, fontWeight: '400' },
  close: { paddingHorizontal: 4 },
  closeText: { color: colors.muted, fontSize: 16 },
  path: { marginTop: 4, color: colors.accent, fontSize: 12, fontFamily: mono, textDecorationLine: 'underline' },
  crumbs: { marginTop: 10, flexGrow: 0 },
  crumbsContent: { alignItems: 'center' },
  crumbRow: { flexDirection: 'row', alignItems: 'center' },
  sep: { color: colors.library, marginHorizontal: 2 },
  crumb: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  crumbActive: { backgroundColor: colors.accent },
  crumbText: { color: colors.component, fontSize: 12, fontFamily: mono },
  actions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  action: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  actionPrimary: { backgroundColor: colors.accent, flex: 1.4 },
  actionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  status: { marginTop: 8, color: colors.muted, fontSize: 12 },
  body: { marginTop: 8, flexGrow: 0 },
  section: { marginTop: 10 },
  sectionTitle: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  row: { flexDirection: 'row', paddingVertical: 2, gap: 10 },
  key: { width: 120, color: colors.muted, fontSize: 12, fontFamily: mono },
  value: { flex: 1, fontSize: 12, fontFamily: mono },
  empty: { color: colors.library, fontSize: 12, fontFamily: mono },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: colors.panelBorder },
  chipText: { color: colors.muted, fontSize: 11 },
});
