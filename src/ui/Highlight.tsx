import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Frame } from '../types';
import { colors, mono } from './theme';

type Props = { frame: Frame; label: string };

export function Highlight({ frame, label }: Props) {
  const labelAbove = frame.y > 24;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[styles.box, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }]}
      />
      <View style={[styles.tag, { left: Math.max(frame.x, 4) }, labelAbove ? { top: frame.y - 22 } : { top: frame.y + frame.height + 4 }]}>
        <Text style={styles.tagText} numberOfLines={1}>
          {label} <Text style={styles.tagSize}>{Math.round(frame.width)}×{Math.round(frame.height)}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.accentFill,
    borderRadius: 2,
  },
  tag: {
    position: 'absolute',
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 4,
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  tagText: { color: '#fff', fontSize: 11, fontWeight: '600', fontFamily: mono },
  tagSize: { fontWeight: '400', opacity: 0.85 },
});
