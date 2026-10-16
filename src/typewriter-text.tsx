import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View, type TextProps, type TextStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

const displayed = new Set<string>();
const supportsBlur = Platform.OS === 'android' || Platform.OS === 'web';
type Props = Omit<TextProps, 'children'> & { text: string; revealKey: string; animate?: boolean; onRevealComplete?: () => void };
// Kinetic Type Motion / Blur Reveal export. Spaces consume stagger slots too.
const preset = { duration: 400, stagger: 20, delay: 0, blurAmount: 12, yOffset: 9.6 };
const easeOut = Easing.bezier(0, 0, 0.58, 1);
type RevealElement = { text: string; index: number };

function RevealingElement({ element, textStyle, animate, onComplete }: { element: RevealElement; textStyle: TextStyle; animate: boolean; onComplete?: () => void }) {
  const progress = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) { progress.value = 1; return; }
    progress.value = withDelay(preset.delay + element.index * preset.stagger,
      withTiming(1, { duration: preset.duration, easing: easeOut }, finished => {
        if (finished && onComplete) runOnJS(onComplete)();
      }));
    return () => cancelAnimation(progress);
  }, [element.index, progress, animate, onComplete]);
  const revealStyle = useAnimatedStyle(() => {
    const fraction = progress.value;
    return {
      opacity: fraction,
      transform: [{ translateY: preset.yOffset * (1 - fraction) }],
      // Allocate blur only while this glyph is moving, not for pending/finished ink.
      ...(supportsBlur ? { filter: fraction > 0 && fraction < 1 ? [{ blur: preset.blurAmount * (1 - fraction) }] : [] } : {}),
    };
  });
  // Transforms reserve the final layout without duplicating every glyph in a hidden layer.
  return <Animated.View style={[styles.glyph, revealStyle]} accessible={false}>
    <Text style={textStyle} accessible={false}>{element.text}</Text>
  </Animated.View>;
}

/** Exported per-element opacity, blur and rise keyframes run on the UI thread. */
export function TypewriterText({ text, revealKey, animate = true, style, onRevealComplete, ...props }: Props) {
  const reducedMotion = useReducedMotion();
  const [screenReader, setScreenReader] = useState(false);
  const played = useRef(displayed.has(revealKey));
  const started = useRef(false);
  const keepGlyphLayout = useRef(displayed.has(revealKey));
  const [finished, setFinished] = useState(false);
  const callback = useRef(onRevealComplete);
  callback.current = onRevealComplete;
  const reported = useRef(false);
  const complete = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    played.current = true;
    setFinished(true);
    callback.current?.();
  }, []);
  const timeline = useMemo(() => {
    let index = 0;
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const paragraphs = lines.map((line, paragraph) => {
      const groups: RevealElement[][] = [];
      for (const value of line.match(/\S+|[ \t]+/g) ?? []) {
        const elements = Array.from(value).map(character => ({ text: character, index: index++ }));
        // Keep a word and its following space together for natural line wrapping,
        // while animating each character (including spaces) separately.
        if (/^[ \t]+$/.test(value) && groups.length) groups[groups.length - 1].push(...elements);
        else groups.push(elements);
      }
      if (paragraph < lines.length - 1) index++;
      return groups;
    });
    const rendered = paragraphs.flat(2);
    return { paragraphs, lastIndex: rendered[rendered.length - 1]?.index ?? -1 };
  }, [text]);
  const flat = StyleSheet.flatten(style) ?? {};
  const { marginTop, marginBottom, marginLeft, marginRight, margin, marginHorizontal, marginVertical, ...textStyle } = flat;
  const layoutStyle = { marginTop, marginBottom, marginLeft, marginRight, margin, marginHorizontal, marginVertical };
  const reveal = animate && !reducedMotion && !screenReader && !played.current && !finished && !!text;
  if (reveal) keepGlyphLayout.current = true;

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => { if (alive) setScreenReader(enabled); });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => { alive = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!animate) {
      if (started.current || played.current) complete();
      return;
    }
    if (reducedMotion || screenReader || played.current || !text || timeline.lastIndex < 0) {
      if (started.current) played.current = true;
      complete();
      return;
    }
    started.current = true;
    displayed.add(revealKey);
  }, [animate, reducedMotion, screenReader, text, revealKey, timeline.lastIndex, complete]);

  if (!keepGlyphLayout.current) return <Text {...props} style={style} accessibilityLabel={text}>{text}</Text>;
  return <View style={layoutStyle} accessible accessibilityRole="text" accessibilityLabel={text} testID={props.testID}>
    {timeline.paragraphs.map((groups, paragraph) => <View key={paragraph} style={[styles.line, { minHeight: textStyle.lineHeight ?? (textStyle.fontSize ?? 16) * 1.2 }]} accessible={false} importantForAccessibility="no-hide-descendants">
      {groups.map((elements, group) => <View key={group} style={styles.group}>{elements.map(element => <RevealingElement key={element.index} element={element} textStyle={textStyle} animate={reveal} onComplete={element.index === timeline.lastIndex ? complete : undefined} />)}</View>)}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  group: { flexDirection: 'row', maxWidth: '100%', overflow: 'visible' },
  glyph: { maxWidth: '100%', overflow: 'visible' },
});
