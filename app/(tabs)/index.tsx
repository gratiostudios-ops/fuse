import { KeyboardVisibilityContext } from '../../src/keyboard-layout';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { recordDisplayed } from '../../api/display-history';
import { useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowCircleRightIcon, ArrowClockwiseIcon, CaretDownIcon, ChecksIcon, NotebookIcon, StopCircleIcon } from 'phosphor-react-native';
import { requestDailyRecap, subscribeOrganizer, type DailyRecap } from '../../api/organizer';
import { colors, fonts } from '../../src/theme';
import { askAI, type FuseResponse } from '../../api/ai';
import { useAuth } from '../../src/auth-context';
import { useOrganizer, OrganizerList } from '../../src/organizer';
import { FuseResponseView } from '../../src/fuse-response';
import { TypingIndicator } from '../../src/typing-indicator';
import { NavigationGestureBoundary } from '../../src/navigation-gestures';
import { getLatestRefresh, initializeRefreshRuntime, refreshNow } from '../../refresh/runtime';
import { subscribeRefresh } from '../../refresh/cache';
import { parseFuseResponse } from '../../supabase/functions/_shared/contract';

const ORGANIZER_ENABLED = false;

export default function HomeScreen() {
  const keyboardVisible = useContext(KeyboardVisibilityContext);
  const [composerFocused, setComposerFocused] = useState(false);
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', () => setComposerFocused(false));
    return () => hidden.remove();
  }, []);
  const inputRef = useRef<TextInput>(null);
  const chatScroll = useRef<ScrollView>(null);
  const [historyBrowsing, setHistoryBrowsing] = useState(false);
  const generation = useRef(0);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const [revealedReply, setRevealedReply] = useState<FuseResponse | null>(null);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'home' | 'chat' | 'recap'>('home');
  const [preview, setPreview] = useState('');
  const [delivered, setDelivered] = useState(false);
  const [inputHeight, setInputHeight] = useState(17);
  const [recap, setRecap] = useState<DailyRecap | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string; response?: FuseResponse }[]>([]);
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const organizer = useOrganizer(userId);
  const [organizerExpanded, setOrganizerExpanded] = useState(false);
  useEffect(() => { setOrganizerExpanded(false); }, [userId]);
  const identity = useRef(userId);
  identity.current = userId;
  const [home, setHome] = useState<FuseResponse | null>(null);
  const [homeError, setHomeError] = useState('');
  const [homeLoading, setHomeLoading] = useState(false);
  useEffect(() => { if (homeError || recapError) console.warn('Home request unavailable', homeError || recapError); }, [homeError, recapError]);

  useEffect(() => {
    let alive = true;
    generation.current++;
    cancelRequest();
    const initialGeneration = generation.current;
    sending.current = false;
    setLoading(false); setInputHeight(17);
    setMode('home'); setPreview(''); setDelivered(false); setRecap(null); setRecapError(''); setRecapLoading(false);
    setMessages([]);
    setMessage('');
    setError('');
    setHome(null);
    setHomeError('');
    if (!userId) { setHomeLoading(false); return () => { generation.current++; }; }
    const update = async () => {
      const updateGeneration = generation.current;
      const record = await getLatestRefresh(userId);
      if (!alive || identity.current !== userId || generation.current !== updateGeneration) return;
      const response = record?.processing.status === 'completed' ? record.processing.response : undefined;
      if (response) setHome(parseFuseResponse(response));
      setHomeError(record?.processing.status === 'error' ? record.processing.error : '');
    };
    const unsubscribe = subscribeRefresh(() => { void update().catch(() => {}); });
    // Hydrate the saved Home independently of a slow or offline refresh.
    void update().catch(() => {});
    setHomeLoading(true);
    void initializeRefreshRuntime().run().then(async result => {
      if (generation.current !== initialGeneration) return;
      await update();
      if (alive && generation.current === initialGeneration) {
        if (result.record?.processing.status === 'error') setHomeError(result.record.processing.error);
        else if (result.status === 'failed') setHomeError(result.reason ?? 'Could not refresh Home.');
      }
    }).catch(err => { if (alive && generation.current === initialGeneration) setHomeError(err instanceof Error ? err.message : 'Could not refresh Home.'); })
      .finally(() => { if (alive && generation.current === initialGeneration) setHomeLoading(false); });
    return () => { alive = false; generation.current++; cancelRequest(); unsubscribe(); };
  }, [userId]);

  useEffect(() => subscribeOrganizer(reason => {
    if (!['disconnect', 'connection', 'signout'].includes(reason)) return;
    generation.current++; cancelRequest(); sending.current = false; inputRef.current?.blur(); Keyboard.dismiss();
    setMode('home'); setOrganizerExpanded(false); setMessages([]); setMessage(''); setPreview(''); setDelivered(false);
    setLoading(false); setError(''); setInputHeight(17); setRecap(null); setRecapError(''); setRecapLoading(false); setHome(null); setHomeError(''); setHomeLoading(false);
  }), []);

  async function reloadHome() {
    if (homeLoading) return;
    const requestGeneration = generation.current;
    const owner = userId;
    setHomeLoading(true);
    setHomeError('');
    try {
      const result = await refreshNow();
      if (identity.current === owner && generation.current === requestGeneration) {
        if (result.record?.processing.status === 'error') setHomeError(result.record.processing.error);
        else if (result.status === 'failed') setHomeError(result.reason ?? 'Could not refresh Home.');
      }
    } catch (err) {
      if (identity.current === owner && generation.current === requestGeneration) setHomeError(err instanceof Error ? err.message : 'Could not refresh Home.');
    } finally { if (identity.current === owner && generation.current === requestGeneration) setHomeLoading(false); }
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  useEffect(() => { if (error) console.warn('Chat request unavailable', error); }, [error]);

  function cancelRequest() {
    requestSequence.current++;
    requestController.current?.abort();
    requestController.current = null;
    setRevealedReply(null);
  }

  async function sendMessage(answer?: string) {
    const input = (answer ?? message).trim();
    if (!input || sending.current || recapLoading) return;
    inputRef.current?.blur();
    Keyboard.dismiss();
    setComposerFocused(false);
    cancelRequest();
    const controller = new AbortController();
    requestController.current = controller;
    const sequence = requestSequence.current;
    const owner = userId;
    const requestGeneration = generation.current;
    sending.current = true;
    setLoading(true);
    inputRef.current?.clear();
    setHistoryBrowsing(false);
    setMode('chat'); setPreview(input); setDelivered(true); setMessage(''); setInputHeight(17);
    setError('');
    try {
      const reply = await askAI(input, messages.map(({ role, text }) => ({ role, text })), controller.signal);
      if (identity.current !== owner || generation.current !== requestGeneration || sequence !== requestSequence.current) return;
      setMessages(previous => [...previous, { role: 'user', text: input }, { role: 'assistant', text: [reply.message, reply.follow_up?.question, reply.follow_up?.options.length ? 'Options: ' + reply.follow_up.options.join('; ') : ''].filter(Boolean).join('\n'), response: reply }]);
    } catch (err) {
      if (identity.current === owner && generation.current === requestGeneration && sequence === requestSequence.current) { setDelivered(false); setError(err instanceof Error ? err.message : 'Unable to reach Fuse AI. Please try again.'); setMessage(draft => draft.length ? draft : input); }
    } finally {
      if (generation.current === requestGeneration && sequence === requestSequence.current) { sending.current = false; if (identity.current === owner) setLoading(false); }
    }
  }

  function clearResult() {
    const stoppedChat = sending.current;
    cancelRequest();
    sending.current = false; setLoading(false); setRecapLoading(false);
    inputRef.current?.blur(); Keyboard.dismiss(); setMode('home'); setMessages([]); setMessage(''); setPreview(''); setDelivered(false); setError(''); setInputHeight(17); setRecap(null); setRecapError('');
    // The server may already have saved an item when its client request is stopped.
    if (stoppedChat) void refreshNow().catch(() => {});
  }
  async function openRecap() {
    if (loading || recapLoading) return;
    cancelRequest();
    const controller = new AbortController();
    requestController.current = controller;
    const sequence = requestSequence.current;
    setPreview(''); setMessage(''); setDelivered(false); setInputHeight(17);
    inputRef.current?.blur(); Keyboard.dismiss(); setMode('recap'); setRecap(null); setRecapError(''); setRecapLoading(true); setOrganizerExpanded(false);
    const owner = userId;
    const requestGeneration = generation.current;
    try {
      const result = await requestDailyRecap(controller.signal);
      if (identity.current === owner && generation.current === requestGeneration && sequence === requestSequence.current) { setRecap(result.recap && Object.values(result.recap.source_status).every(status => status === 'ok') ? result.recap : null); if (!result.recap) setRecapError(result.message || 'Recap is being prepared. Try again shortly.'); }
    } catch (reason) { if (identity.current === owner && generation.current === requestGeneration && sequence === requestSequence.current) setRecapError(reason instanceof Error ? reason.message : 'Could not generate recap.'); }
    finally { if (identity.current === owner && generation.current === requestGeneration && sequence === requestSequence.current) setRecapLoading(false); }
  }
  const latestReply = [...messages].reverse().find(item => item.role === 'assistant')?.response;
  const replyFinished = !!latestReply && revealedReply === latestReply && !loading && !error;
  const replyNeedsAnswer = !!latestReply?.follow_up
    || (latestReply?.follow_up === undefined && /[?？]/.test(messages[messages.length - 1]?.text ?? ''));
  const hasReplyActions = !!latestReply?.follow_up?.options.length || (!!latestReply && !replyNeedsAnswer);
  const doneVisible = replyFinished && !replyNeedsAnswer;
  const focused = useIsFocused();
  const visibleResponse = mode === 'home' ? home : mode === 'chat' && !loading ? latestReply : null;
  useEffect(() => {
    const record = () => { if (focused && userId && visibleResponse && AppState.currentState === 'active') void recordDisplayed(userId, visibleResponse).catch(() => {}); };
    record();
    const subscription = AppState.addEventListener('change', record);
    return () => subscription.remove();
  }, [focused, userId, visibleResponse]);
  const olderReplies = (loading || error ? messages : messages.slice(0, -2)).filter(item => item.role === 'assistant' && item.response);
  const showStop = loading || recapLoading;
  const hasHomeOutput = !!home && (!!home.message.trim() || home.blocks.length > 0);
  const hasActivities = home?.blocks.some(block => block.type === 'task' || block.type === 'schedule');
  const activitiesToday = home?.blocks.filter(block => block.type === 'task' || block.type === 'schedule').every(block => {
    const today = new Date().toLocaleDateString('en-CA');
    return block.type === 'task' ? block.data.due_date === today : block.type === 'schedule' && (block.data.is_all_day ? block.data.start_date === today : new Date(block.data.start).toLocaleDateString('en-CA') === today);
  });
  return (
    <View style={styles.screen}>
      {ORGANIZER_ENABLED && <NavigationGestureBoundary><Pressable accessibilityRole="button" accessibilityLabel="Organizer" accessibilityState={{ expanded: organizerExpanded }} onPress={() => setOrganizerExpanded(value => !value)} style={styles.organizer}>
        <Text style={styles.organizerLabel}>Organizer</Text>
        <CaretDownIcon size={17} color={colors.foreground} style={[styles.caret, organizerExpanded && { transform: [{ rotate: '180deg' }] }]} />
      </Pressable></NavigationGestureBoundary>}
      <View style={[styles.body, (keyboardVisible || composerFocused) && styles.contentDimmed]}>
        {mode === 'home' && !!userId && <NavigationGestureBoundary style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Daily recap" disabled={loading || recapLoading} onPress={() => { void openRecap(); }} style={styles.iconButton}><NotebookIcon weight="bold" size={19} color="#606060" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh Home" accessibilityState={{ busy: homeLoading }} disabled={homeLoading} onPress={reloadHome} style={styles.iconButton}><ArrowClockwiseIcon weight="bold" size={19} color={homeLoading ? '#606060' : '#929292'} /></Pressable>
        </NavigationGestureBoundary>}
        <ScrollView ref={chatScroll} style={styles.scroll} scrollEventThrottle={32}
          onScrollBeginDrag={() => { if (mode === 'chat') setHistoryBrowsing(true); }}
          onScroll={event => {
            if (mode !== 'chat') return;
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            setHistoryBrowsing(contentOffset.y < contentSize.height - layoutMeasurement.height - 24);
          }}
          onScrollEndDrag={event => {
            if (mode !== 'chat') return;
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            setHistoryBrowsing(contentOffset.y < contentSize.height - layoutMeasurement.height - 24);
          }}
          onContentSizeChange={() => {
            if (mode === 'chat' && !historyBrowsing) requestAnimationFrame(() => chatScroll.current?.scrollToEnd({ animated: true }));
          }} contentContainerStyle={[styles.centered, mode === 'home' && styles.homeCentered]} keyboardShouldPersistTaps="handled">
          {mode === 'home' ? <View style={[styles.main, styles.homeMain]}>
            {ORGANIZER_ENABLED && organizerExpanded ? <OrganizerList controller={organizer} expanded /> : <>
              {!!userId && home && <><Text style={[styles.heading, styles.homeHeading]}>{hasActivities ? activitiesToday ? 'Today’s Plan' : 'Your Plan' : 'For you'}</Text><FuseResponseView response={home} presentation="home" /></>}
              {!userId && <Text style={styles.homeBodyText}>Sign in from the account menu to see your tasks and events.</Text>}
              {homeLoading && !hasHomeOutput && <Text style={styles.homeBodyText}>Updating Home…</Text>}
              {!homeLoading && !hasHomeOutput && !!homeError && <Text accessibilityRole="alert" numberOfLines={4} style={styles.requestError}>{homeError}</Text>}
            </>}
          </View> : <View style={styles.main}>
            {mode === 'chat' ? <>
              {messages.length > (loading || error ? 0 : 2) && <View style={styles.history}>
                {olderReplies.map((item, index) =>
                  <View key={index} style={styles.oldTurn}><FuseResponseView response={item.response!} muted historyOpacity={Math.min(0.86, Math.max(0.28, 0.66 - (olderReplies.length - 1 - index) * 0.12) + (historyBrowsing ? 0.2 : 0))} /></View>
                )}
              </View>}
              {!loading && !error && latestReply && <>
                <FuseResponseView key={latestReply.response_id ?? messages.length} response={latestReply} onRevealComplete={() => setRevealedReply(latestReply)} />
                {hasReplyActions && <NavigationGestureBoundary style={[styles.replyActions, !replyFinished && styles.actionsPending]}
                  pointerEvents={replyFinished ? 'auto' : 'none'} accessibilityElementsHidden={!replyFinished} importantForAccessibility={replyFinished ? 'auto' : 'no-hide-descendants'}>
                  {latestReply.follow_up?.options.length ? <View style={styles.choices}>
                    {latestReply.follow_up.options.map(option => <Pressable key={option} accessibilityRole="button" accessibilityLabel={option} disabled={!replyFinished || loading} onPress={() => { void sendMessage(option); }} style={styles.choice}><Text style={styles.choiceText}>{option}</Text></Pressable>)}
                  </View> : <Pressable accessibilityRole="button" accessibilityLabel="Done" disabled={!doneVisible} onPress={clearResult} style={styles.pill}><Text style={styles.pillText}>Done</Text></Pressable>}
                </NavigationGestureBoundary>}
              </>}
              {loading && <TypingIndicator />}
              {!loading && !!error && <Text accessibilityRole="alert" numberOfLines={4} style={styles.requestError}>{error}</Text>}
            </> : <>
              <Text style={styles.heading}>Daily recap{recap ? ' · ' + recap.local_date : ''}</Text>
              {recapLoading && <Text style={styles.messageText}>Preparing your recap…</Text>}
              {!recapLoading && !recap && !!recapError && <Text accessibilityRole="alert" numberOfLines={4} style={styles.requestError}>{recapError}</Text>}
              {recap && <><Text style={styles.subheading}>Completed today</Text><Text style={styles.messageText}>{recap.completed_today}</Text><Text style={styles.subheading}>Tomorrow’s plan</Text><Text style={styles.messageText}>{recap.tomorrow_plan}</Text><Text style={styles.recapDate}>As of {new Date(recap.generated_at).toLocaleString(undefined, { timeZone: recap.timezone })} · {recap.timezone}</Text></>}
            </>}
            {mode === 'recap' && !recapLoading && <NavigationGestureBoundary><Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={clearResult} style={styles.pill}><Text style={styles.pillText}>Done</Text></Pressable></NavigationGestureBoundary>}
          </View>}
        </ScrollView>
      </View>
      <NavigationGestureBoundary style={[styles.composer, keyboardVisible && { marginBottom: 10 }]} accessibilityLabel="Chat composer">
        {!!preview && <View style={styles.preview}><Text numberOfLines={4} ellipsizeMode="tail" style={styles.previewText}>{preview}</Text>{delivered && <View accessible accessibilityLabel="Message delivered" style={styles.delivery}><ChecksIcon size={20} color="#168BFF" /></View>}</View>}
        <View style={styles.input}>
          <TextInput ref={inputRef} style={[styles.placeholder, { height: Math.min(preview ? 68 : 136, Math.max(17, inputHeight)), maxHeight: preview ? 68 : 136 }]} placeholder={mode === 'chat' && latestReply?.follow_up ? latestReply.follow_up.options.length ? 'Or type your own answer' : 'Type your answer' : 'Ask anything'} placeholderTextColor={colors.placeholder}
            onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)}
            underlineColorAndroid="transparent" accessibilityLabel="Message to Fuse AI" value={message} onChangeText={setMessage}
            onContentSizeChange={event => setInputHeight(event.nativeEvent.contentSize.height)} multiline scrollEnabled maxLength={2000} editable textAlignVertical="top" />
          <Pressable accessibilityRole="button" accessibilityLabel={showStop ? 'Stop and return Home' : 'Send message'} style={styles.send}
            disabled={!showStop && !message.trim()} onPress={showStop ? clearResult : () => { void sendMessage(); }}>
            {showStop ? <StopCircleIcon size={36} weight="fill" color="#E8E8E8" /> : <ArrowCircleRightIcon size={36} weight="fill" color="#E8E8E8" />}
          </Pressable>
        </View>
      </NavigationGestureBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  organizer: { height: 31, marginLeft: 24, marginRight: 25, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0 },
  organizerLabel: { marginLeft: 3, fontFamily: fonts.medium, fontSize: 14, lineHeight: 17, color: '#F8FAFC', includeFontPadding: false },
  caret: { marginTop: 5, marginRight: 4 },
  body: { flex: 1, minHeight: 0 },
  contentDimmed: { opacity: 0.4, backgroundColor: '#000000', ...((Platform.OS === 'android' || Platform.OS === 'web') ? { filter: [{ blur: 1 }] } : {}) },
  actions: { position: 'absolute', top: 0, right: 16, zIndex: 1, height: 44, flexDirection: 'row', justifyContent: 'flex-end' },
  iconButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  centered: { flexGrow: 1, justifyContent: 'center', paddingVertical: 20 },
  homeCentered: { paddingVertical: 10 },
  main: { paddingLeft: 24, paddingRight: 29, gap: 16 },
  homeMain: { gap: 8 },
  replyActions: { minHeight: 44 },
  actionsPending: { opacity: 0 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderRadius: 22, borderWidth: 1, borderColor: '#515151', backgroundColor: '#232323', paddingHorizontal: 16, paddingVertical: 12, minHeight: 44 },
  choiceText: { fontFamily: fonts.medium, color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
  history: { gap: 18, marginBottom: 6 },
  oldTurn: { gap: 8 },
  heading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 22, color: '#FFFFFF', marginBottom: 23, marginLeft: 2 },
  homeHeading: { marginBottom: 13, transform: [{ translateY: -5 }] },
  recapDate: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: '#929292' },
  subheading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 17, color: '#E6E6E6' },
  homeBodyText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 16, color: '#E6E6E6' },
  requestError: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: '#929292' },
  messageText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: '#E6E6E6' },
  pill: { width: 131, minHeight: 39, borderRadius: 224, backgroundColor: '#D9D9D9', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  pillText: { fontFamily: fonts.heading, fontSize: 18, lineHeight: 20, color: '#000000' },
  disabled: { opacity: 0.45 },
  composer: { flexShrink: 0, marginLeft: 16, marginRight: 17, marginBottom: 7, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 9, backgroundColor: '#121212', borderRadius: 33 },
  input: { minHeight: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.0784314)', paddingLeft: 16, paddingRight: 48, paddingVertical: 17 },
  placeholder: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 17, color: '#E6E6E6', includeFontPadding: false, padding: 0, borderWidth: 0, ...(Platform.OS === 'web' ? { outlineWidth: 0, outlineStyle: 'solid', outlineColor: 'transparent' } : {}) },
  send: { position: 'absolute', right: 0, bottom: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  preview: { paddingVertical: 13, paddingHorizontal: 15, paddingRight: 30, marginBottom: 3 },
  previewText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 17, color: '#E6E6E6' },
  delivery: { position: 'absolute', right: 15, bottom: 12 },
});
