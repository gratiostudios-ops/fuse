import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { clampProgress, navigationAxis, projectedDestination, type NavigationAxis } from './navigation-motion-policy';

const glide = { duration: 240, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const spring = { stiffness: 320, damping: 36, mass: 1, overshootClamping: true };

type MotionOptions = {
  width: number;
  panelWidth: number;
  panelOpen: boolean;
  suggestions: boolean;
  reduceMotion: boolean;
  onPanelChange: (open: boolean) => void;
  onPageChange: (suggestions: boolean) => void;
};

export function useNavigationMotion({ width, panelWidth, panelOpen, suggestions, reduceMotion, onPanelChange, onPageChange }: MotionOptions) {
  const panel = useSharedValue(0);
  const page = useSharedValue(suggestions ? 1 : 0);
  const panelTarget = useSharedValue(0);
  const pageTarget = useSharedValue(suggestions ? 1 : 0);
  const originPanel = useSharedValue(0);
  const originPage = useSharedValue(0);
  const axis = useSharedValue<NavigationAxis | null>(null);
  const dragging = useSharedValue(false);
  const [panelSettled, setPanelSettled] = useState(true);
  const markPanelSettled = useCallback((settled: boolean) => setPanelSettled(settled), []);

  useLayoutEffect(() => {
    const target = suggestions ? 1 : 0;
    if (reduceMotion) {
      cancelAnimation(page);
      pageTarget.value = target;
      page.value = target;
    } else if (pageTarget.value !== target) {
      pageTarget.value = target;
      page.value = withTiming(target, glide);
    }
  }, [suggestions, reduceMotion, page, pageTarget]);

  useLayoutEffect(() => {
    const target = panelOpen ? 1 : 0;
    if (reduceMotion) {
      cancelAnimation(panel);
      panelTarget.value = target;
      panel.value = target;
      setPanelSettled(true);
    } else if (panelTarget.value !== target) {
      setPanelSettled(false);
      panelTarget.value = target;
      panel.value = withTiming(target, glide, finished => {
        if (finished) runOnJS(markPanelSettled)(true);
      });
    }
  }, [panelOpen, reduceMotion, panel, panelTarget, markPanelSettled]);

  useEffect(() => () => { cancelAnimation(panel); cancelAnimation(page); }, [panel, page]);

  const gesture = useMemo(() => Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .maxPointers(1)
    .onStart(event => {
      cancelAnimation(panel);
      cancelAnimation(page);
      originPanel.value = panel.value;
      originPage.value = page.value;
      axis.value = panel.value > 0.001 || panelTarget.value === 1 || page.value > 0.001 || pageTarget.value === 1 || event.translationX !== 0
        ? navigationAxis(panel.value, panelTarget.value, page.value, pageTarget.value, event.translationX) : null;
      dragging.value = true;
      if (axis.value === 'panel') runOnJS(markPanelSettled)(false);
    })
    .onUpdate(event => {
      // Some platforms activate with zero translation: choose the direction on first movement.
      if (axis.value === null && event.translationX !== 0) {
        axis.value = navigationAxis(originPanel.value, panelTarget.value, originPage.value, pageTarget.value, event.translationX);
        if (axis.value === 'panel') runOnJS(markPanelSettled)(false);
      }
      if (reduceMotion || axis.value === null) return;
      if (axis.value === 'panel') panel.value = clampProgress(originPanel.value + event.translationX / panelWidth);
      else page.value = clampProgress(originPage.value - event.translationX / width);
    })
    .onEnd(event => {
      if (axis.value === null) return;
      if (axis.value === 'panel') {
        const progress = reduceMotion ? clampProgress(originPanel.value + event.translationX / panelWidth) : panel.value;
        const target = projectedDestination(progress, event.velocityX, panelWidth);
        panelTarget.value = target;
        if (reduceMotion) {
          panel.value = target;
          runOnJS(markPanelSettled)(true);
        } else panel.value = withSpring(target, { ...spring, velocity: event.velocityX / panelWidth }, finished => {
          if (finished) runOnJS(markPanelSettled)(true);
        });
        runOnJS(onPanelChange)(target === 1);
      } else {
        const progress = reduceMotion ? clampProgress(originPage.value - event.translationX / width) : page.value;
        const target = projectedDestination(progress, -event.velocityX, width);
        pageTarget.value = target;
        page.value = reduceMotion ? target : withSpring(target, { ...spring, velocity: -event.velocityX / width });
        runOnJS(onPageChange)(target === 1);
      }
    })
    .onFinalize((_event, success) => {
      if (!dragging.value) return;
      dragging.value = false;
      if (success || axis.value === null) return;
      // Cancelled gestures settle to the last committed destination.
      if (axis.value === 'panel') {
        if (reduceMotion) {
          panel.value = panelTarget.value;
          runOnJS(markPanelSettled)(true);
        } else panel.value = withSpring(panelTarget.value, spring, finished => {
          if (finished) runOnJS(markPanelSettled)(true);
        });
      } else page.value = reduceMotion ? pageTarget.value : withSpring(pageTarget.value, spring);
    }), [panel, page, panelTarget, pageTarget, originPanel, originPage, axis, dragging, width, panelWidth, reduceMotion, markPanelSettled, onPanelChange, onPageChange]);

  const canvasStyle = useAnimatedStyle(() => ({ transform: [{ translateX: panel.value * panelWidth }] }));
  const panelStyle = useAnimatedStyle(() => ({ opacity: panel.value }));
  const homeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -page.value * width }] }));
  const suggestionsStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - page.value) * width }] }));

  return { gesture, canvasStyle, panelStyle, homeStyle, suggestionsStyle, panelSettled };
}
