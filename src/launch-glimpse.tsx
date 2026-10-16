import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
const LONG_BREAK_MS = 30 * 60 * 1000;

export function LaunchGlimpse({ onReady }: { onReady: () => Promise<void> }) {
  const [visible, setVisible] = useState(true);
  const [run, setRun] = useState(0);
  const [laidOut, setLaidOut] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let awayAt: number | null = null;
    const active = () => Platform.OS === 'web' ? document.visibilityState === 'visible' : AppState.currentState === 'active';
    const changed = () => {
      if (!active()) {
        if (awayAt === null) awayAt = Date.now();
        return;
      }
      if (awayAt !== null && Date.now() - awayAt >= LONG_BREAK_MS) {
        opacity.setValue(1);
        logoOpacity.setValue(0);
        setVisible(true);
        setRun(value => value + 1);
      }
      awayAt = null;
    };
    const subscription = AppState.addEventListener('change', changed);
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', changed);
    return () => {
      subscription.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', changed);
    };
  }, [opacity, logoOpacity]);

  useEffect(() => {
    if (!laidOut) return;
    let alive = true;
    let animation: Animated.CompositeAnimation | undefined;
    let frame: number | undefined;
    void (async () => {
      const reduced = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      // The visible duration starts after the native splash has closed.
      await onReady();
      if (!alive) return;
      frame = requestAnimationFrame(() => {
        animation = Animated.sequence([
            Animated.timing(logoOpacity, { toValue: 1, duration: reduced ? 0 : 150, useNativeDriver: true }),
            Animated.delay(reduced ? 1000 : 650),
            Animated.timing(opacity, { toValue: 0, duration: reduced ? 0 : 200, useNativeDriver: true }),
        ]);
        animation.start(({ finished }) => { if (alive && finished) setVisible(false); });
      });
    })().catch(() => { if (alive) setVisible(false); });
    return () => {
      alive = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      animation?.stop();
    };
  }, [laidOut, run, onReady, opacity, logoOpacity]);

  if (!visible) return null;
  return (
    <Animated.View onLayout={() => setLaidOut(true)} pointerEvents="auto" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.overlay, { opacity }]}>
      <Animated.View style={[styles.logoPadding, { opacity: logoOpacity }]}>
      <Svg width={92} height={92} viewBox="220 220 870 870">
        <Path fill="#007BFF" d="M322 720V568C322 428 431 315 574 315H930C1005 315 998 378 958 433C921 485 869 511 797 512H654C507 512 401 595 322 720Z M343 877V795C343 670 431 569 568 569H788C840 569 839 603 807 649C774 699 739 722 666 722H585C475 722 393 790 343 877Z M357 929C357 858 434 754 514 754C579 754 592 794 577 848C556 921 477 984 416 984C376 984 357 965 357 929Z" />
      </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  logoPadding: { padding: 28, alignItems: 'center', justifyContent: 'center' },
});
