import { SuggestionCard } from './suggestion-card';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { useIsFocused } from 'expo-router';
import { TypewriterText } from './typewriter-text';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { FuseResponse } from '../api/ai';
import { deduplicateResponseText } from '../supabase/functions/_shared/contract';
import { colors, fonts } from './theme';
import { ActivityRow } from './activity-row';

const replyKeys = new WeakMap<FuseResponse, string>();
let replySequence = 0;
function responseKey(response: FuseResponse) {
  if (response.response_id) return response.response_id;
  let key = replyKeys.get(response);
  if (!key) { key = 'reply-' + ++replySequence; replyKeys.set(response, key); }
  return key;
}

export function FuseResponseView({ response, presentation = 'chat', muted = false, historyOpacity = 0.66, onRevealComplete }: { response: FuseResponse; onRevealComplete?: () => void; presentation?: 'home' | 'chat'; muted?: boolean; historyOpacity?: number }) {
  const copy = useMemo(() => deduplicateResponseText(response), [response]);
  const message = copy.message;
  const focused = useIsFocused();
  const animateText = focused && presentation === 'chat' && !muted;
  const revealKey = responseKey(response);
  const parts = useMemo(() => [
    ...(copy.message ? ['message'] : []),
    ...(presentation === 'chat' && response.follow_up ? ['question'] : []),
    ...(presentation === 'chat' ? copy.blocks.flatMap((block, index) => block.type === 'text' ? ['text:' + index] : []) : []),
  ], [copy, presentation]);
  const completion = useRef({ response, finished: new Set<string>(), reported: false });
  const completionCallback = useRef(onRevealComplete);
  completionCallback.current = onRevealComplete;
  if (completion.current.response !== response) completion.current = { response, finished: new Set<string>(), reported: false };
  const finishPart = useCallback((part?: string) => {
    const current = completion.current;
    if (current.response !== response || current.reported) return;
    if (part) current.finished.add(part);
    if (parts.every(key => current.finished.has(key))) {
      current.reported = true;
      completionCallback.current?.();
    }
  }, [response, parts]);
  useEffect(() => { if (!parts.length) finishPart(); }, [parts, finishPart]);
  const opacity = useSharedValue(muted ? historyOpacity : 1);
  useEffect(() => { opacity.value = withTiming(muted ? historyOpacity : 1, { duration: 180 }); }, [muted, historyOpacity, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.container, presentation === 'home' && styles.homeContainer, fadeStyle]}>
    {copy.blocks.map((block, index) => {
      if (block.type === 'text') return null;
      if (block.type === 'task') return <ActivityRow key={'task:' + block.data.id} kind="task" title={block.data.title} date={block.data.due_date} completed={block.data.is_completed} />;
      if (block.type === 'schedule') return <ActivityRow key={'schedule:' + block.data.id} kind="schedule" title={block.data.title} date={block.data.is_all_day ? block.data.start_date + 'T12:00:00' : block.data.start} allDay={block.data.is_all_day} completed={block.data.is_completed} />;
      return <SuggestionCard key={'suggestion:' + block.data.id} suggestion={block.data} />;
    })}
    {!!message && <TypewriterText key={revealKey + ':message'} revealKey={revealKey + ':message'} text={message} animate={animateText} onRevealComplete={() => finishPart('message')} style={[styles.message, presentation === 'home' && styles.homeMessage, muted && styles.oldMessage]} />}
    {presentation === 'chat' && !!response.follow_up && <TypewriterText key={revealKey + ':question'} revealKey={revealKey + ':question'} text={response.follow_up.question} animate={animateText} onRevealComplete={() => finishPart('question')} style={[styles.question, muted && styles.oldMessage]} />}
    {presentation === 'chat' && copy.blocks.map((block, index) => block.type === 'text' ? <TypewriterText key={revealKey + ':text:' + index} revealKey={revealKey + ':text:' + index} text={block.data.content} animate={animateText} onRevealComplete={() => finishPart('text:' + index)} style={styles.reason} /> : null)}
  </Animated.View>;
}
const styles = StyleSheet.create({
  container: { gap: 12 },
  oldMessage: { color: '#E6E6E6' },
  question: { fontFamily: fonts.semibold, color: '#FFFFFF', fontSize: 16, lineHeight: 22 },
  message: { fontFamily: fonts.semibold, color: '#FFFFFF', fontSize: 16, lineHeight: 19, marginTop: 24 },
  homeContainer: { gap: 8 },
  homeMessage: { fontSize: 14, lineHeight: 16, marginTop: 12 },
  reason: { fontFamily: fonts.regular, color: colors.placeholder, fontSize: 12 },
});
