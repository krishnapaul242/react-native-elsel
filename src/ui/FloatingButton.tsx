import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { colors } from './theme';

const SIZE = 44;
const MARGIN = 8;
const TAP_SLOP = 6;

type Props = { width: number; height: number; onPress: () => void };

// Kept outside the component so the button stays where it was dragged across
// remounts (Fast Refresh, navigation resets).
let lastPosition: { x: number; y: number } | null = null;

export function FloatingButton({ width, height, onPress }: Props) {
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(Math.max(p.x, MARGIN), width - SIZE - MARGIN),
    y: Math.min(Math.max(p.y, MARGIN), height - SIZE - MARGIN),
  });
  const [position, setPosition] = useState(() => clamp(lastPosition ?? { x: width - SIZE - MARGIN, y: height * 0.62 }));
  const start = useRef(position);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          if (lastPosition) start.current = lastPosition;
        },
        onPanResponderMove: (_, g) => {
          const { width: w, height: h } = sizeRef.current;
          const next = {
            x: Math.min(Math.max(start.current.x + g.dx, MARGIN), w - SIZE - MARGIN),
            y: Math.min(Math.max(start.current.y + g.dy, MARGIN), h - SIZE - MARGIN),
          };
          lastPosition = next;
          setPosition(next);
        },
        onPanResponderRelease: (_, g) => {
          if (Math.hypot(g.dx, g.dy) < TAP_SLOP) onPressRef.current();
        },
      }),
    [],
  );

  // Stay on screen after rotation or a window resize.
  const shown = clamp(position);
  lastPosition = shown;

  return (
    <View
      {...responder.panHandlers}
      style={[styles.button, { left: shown.x, top: shown.y }]}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Inspect element (elsel)"
    >
      <View style={styles.ring}>
        <View style={styles.dot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1.5,
    borderColor: colors.accent,
    opacity: 0.92,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  ring: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.accent },
});
