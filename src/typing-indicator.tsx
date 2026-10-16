import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

function TypingDot({ index }: { index: number }) {
  const reducedMotion = useReducedMotion();
  const phase = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) { phase.value = 0.5; return; }
    const pulse = { duration: 280, easing: Easing.inOut(Easing.quad) };
    phase.value = withDelay(index * 140, withRepeat(withSequence(
      withTiming(1, pulse), withTiming(0, pulse), withTiming(0, { duration: 280 }),
    ), -1, false));
    return () => cancelAnimation(phase);
  }, [index, phase, reducedMotion]);
  const motion = useAnimatedStyle(() => ({
    opacity: 0.35 + phase.value * 0.65,
    transform: [{ translateY: -2 * phase.value }, { scale: 0.75 + phase.value * 0.25 }],
  }));
  return <Animated.View style={[styles.dot, motion]} />;
}

export function TypingIndicator() {
  return <View style={styles.row} accessible accessibilityRole="progressbar" accessibilityLabel="Fuse is replying" accessibilityState={{ busy: true }}>
    {[0, 1, 2].map(index => <TypingDot key={index} index={index} />)}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D5D5D5' },
});
