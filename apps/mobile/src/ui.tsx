import { BlurView } from 'expo-blur';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  type PressableProps,
  Pressable,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  View,
} from 'react-native';
import { colors } from './theme';

type GlassSurfaceProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
};

/** A restrained glass surface for navigation and controls, not content cards. */
export function GlassSurface({ children, style, intensity = 38 }: GlassSurfaceProps) {
  return (
    <BlurView
      tint="dark"
      intensity={Platform.OS === 'ios' ? intensity : Math.min(intensity, 28)}
      style={[styles.glass, style]}
    >
      {children}
    </BlurView>
  );
}

/** Press interaction that respects the system Reduce Motion preference. */
export function SpringPressable({ children, onPressIn, onPressOut, disabled, ...props }: PressableProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => subscription?.remove();
  }, []);

  const animate = (value: number) => {
    if (reduceMotion || disabled) return;
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 26,
      bounciness: 5,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        {...props}
        disabled={disabled}
        onPressIn={(event) => {
          animate(0.975);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          animate(1);
          onPressOut?.(event);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** A quiet pulsing placeholder that avoids abrupt content jumps. */
export function Skeleton({ style }: { style: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.36)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.78, duration: 720, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.36, duration: 720, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skeleton, style, { opacity }]} />;
}

export function FleetLoadingSkeleton() {
  return (
    <View style={styles.loadingList} accessibilityLabel="Loading vehicles">
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={styles.loadingRow}>
          <Skeleton style={styles.loadingIcon} />
          <View style={styles.loadingCopy}>
            <Skeleton style={styles.loadingTitle} />
            <Skeleton style={styles.loadingText} />
            <Skeleton style={styles.loadingTextShort} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: {
    overflow: 'hidden',
    // Enough opacity to stay legible over a busy satellite/map background.
    backgroundColor: 'rgba(8, 22, 45, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(210, 230, 255, 0.27)',
  },
  skeleton: { backgroundColor: colors.inkSoft, borderRadius: 8 },
  loadingList: { padding: 16, gap: 10 },
  loadingRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: colors.inkRaised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  loadingIcon: { width: 45, height: 45, borderRadius: 15 },
  loadingCopy: { flex: 1, gap: 8, paddingVertical: 2 },
  loadingTitle: { width: '48%', height: 13 },
  loadingText: { width: '84%', height: 10 },
  loadingTextShort: { width: '36%', height: 10 },
});
