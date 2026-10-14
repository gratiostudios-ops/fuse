import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Image, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HouseIcon, LightbulbIcon, ListIcon } from 'phosphor-react-native';
import { signInWithGoogle, signOut } from '../../api/auth';
import { getTopics } from '../../api/topics';
import type { Topic } from '../../api/types';
import { getUserTopicIds, setUserTopicIds } from '../../api/user-topics';
import { getRefreshTopicIds, setRefreshTopicIds } from '../../refresh';
import { useAuth } from '../../src/auth-context';
import { NavigationGestureBoundary, NavigationGestureContext, swipeDestination } from '../../src/navigation-gestures';
import { colors, fonts } from '../../src/theme';

export default function TabLayout() {
  const pathname = usePathname();
  const suggestionsActive = pathname === '/suggestions';
  const insets = useSafeAreaInsets();
  const { session, loading, error: authError } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [width, setWidth] = useState(402);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const shift = useRef(new Animated.Value(0)).current;
  const excluded = useRef(false);
  const drawerWidth = Math.min(230, width * 230 / 402);
  const metadata = session?.user.user_metadata;
  const name = metadata?.full_name || metadata?.name || session?.user.email?.split('@')[0] || 'Account';

  useEffect(() => {
    Animated.timing(shift, { toValue: drawerOpen ? drawerWidth : 0, duration: 220, useNativeDriver: true }).start();
  }, [drawerOpen, drawerWidth, shift]);
  useEffect(() => { setDrawerOpen(false); setError(null); }, [session?.user.id]);
  useEffect(() => {
    if (!drawerOpen || !session) return;
    let alive = true;
    void Promise.all([getTopics(), getUserTopicIds(session.user.id)]).then(([catalog, selected]) => {
      if (alive) { setTopics(catalog); setTopicIds(selected); }
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load topics.'); });
    return () => { alive = false; };
  }, [drawerOpen, session]);
  useEffect(() => {
    if (!drawerOpen) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { setDrawerOpen(false); return true; });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false); };
    if (Platform.OS === 'web') window.addEventListener('keydown', escape);
    return () => { back.remove(); if (Platform.OS === 'web') window.removeEventListener('keydown', escape); };
  }, [drawerOpen]);

  const gestures = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: event => {
      // Capture resets before a nested NavigationGestureBoundary marks this touch.
      const target = event.target as unknown as { closest?: (selector: string) => unknown };
      excluded.current = !!target?.closest?.('input, textarea, button, a, [role="button"], [role="tab"], [contenteditable="true"]');
      return false;
    },
    onMoveShouldSetPanResponder: (_event, state) => !excluded.current && state.numberActiveTouches === 1 && Math.abs(state.dx) > 18 && Math.abs(state.dx) > Math.abs(state.dy) * 1.6,
    onPanResponderRelease: (_event, state) => {
      if (excluded.current) return;
      const destination = swipeDestination(state.dx, state.dy, drawerOpen, suggestionsActive);
      if (destination === 'close') setDrawerOpen(false);
      else if (destination === 'accounts') setDrawerOpen(true);
      else if (destination === 'home') router.navigate('/');
      else if (destination === 'suggestions') router.navigate('/suggestions');
    },
  }), [drawerOpen, suggestionsActive]);

  async function accountAction() {
    setBusy(true); setError(null);
    try {
      if (session) {
        await signOut(); setDrawerOpen(false); router.replace('/');
      } else {
        const result = await signInWithGoogle();
        if (result.status === 'cancelled') setError('Sign-in cancelled. You can try again.');
        if (result.status === 'signed-in') { setDrawerOpen(false); router.replace('/'); }
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update your account.'); }
    finally { setBusy(false); }
  }

  async function toggleTopic(topicId: string) {
    const next = topicIds.includes(topicId) ? topicIds.filter(id => id !== topicId) : [...topicIds, topicId];
    setTopicIds(next);
    try { await setUserTopicIds(next); await setRefreshTopicIds(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save topics.'); }
  }

  return (
    <NavigationGestureContext.Provider value={excluded}>
      <View style={styles.frame} onLayout={event => setWidth(event.nativeEvent.layout.width)} {...gestures.panHandlers}>
        {drawerOpen && <View accessibilityLabel="Account panel" style={[styles.drawer, { width: drawerWidth, top: Math.max(52, insets.top + 16), bottom: 100 + insets.bottom }]}>
          {session ? <View style={styles.accountDetails}>
            <View style={styles.identity}>
              <Text style={styles.name}>{String(name)}</Text>
              <Text style={styles.email}>{session.user.email ?? ''}</Text>
            </View>
            <View style={[styles.section, styles.topicsSection]}>
              <Text style={styles.sectionLabel}>Topics</Text>
              <View style={styles.topicChips}>{topics.filter(topic => topicIds.includes(topic.id)).map(topic => <Pressable key={topic.id} accessibilityRole="button" onPress={() => void toggleTopic(topic.id)} style={styles.topicChip}><Text style={styles.topicText}>{topic.name}</Text></Pressable>)}</View>
              <Pressable accessibilityRole="button" accessibilityLabel="Add topic" onPress={() => setTopicsOpen(value => !value)} style={styles.addTopic}><Text style={styles.addTopicText}>Add +</Text></Pressable>
              {topicsOpen && <ScrollView style={styles.topicMenu} nestedScrollEnabled>{topics.map(topic => <Pressable key={topic.id} accessibilityRole="button" onPress={() => void toggleTopic(topic.id)} style={styles.topicOption}><Text style={[styles.topicOptionText, topicIds.includes(topic.id) && styles.topicOptionSelected]}>{topic.name}</Text></Pressable>)}</ScrollView>}
            </View>
            <View style={[styles.section, styles.connectorsSection]}>
              <Text style={styles.sectionLabel}>Connectors</Text>
              <Image accessibilityLabel="Google Calendar" source={require('../../ref/elements/Google_Calendar-Logo.wine.svg')} style={styles.connector} />
            </View>
          </View> : <View style={styles.loggedOut}><Text style={styles.loginCopy}>login for full experience of{`\n`}the application</Text></View>}
          <NavigationGestureBoundary style={styles.accountActions}>
            {(error || authError) && <Text accessibilityRole="alert" style={styles.error}>{error ?? authError}</Text>}
            <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => void accountAction()} style={styles.accountButton}>
              {busy || loading ? <ActivityIndicator color={colors.foreground} /> : <Text style={styles.accountButtonText}>{session ? 'logout' : 'login'}</Text>}
            </Pressable>
          </NavigationGestureBoundary>
        </View>}
        <Animated.View style={[styles.canvas, { transform: [{ translateX: shift }] }]}>
          <Tabs style={styles.tabs}>
            <View style={[styles.header, { height: Math.max(134, insets.top + 78) }]}>
              <NavigationGestureBoundary style={[styles.menu, { top: Math.max(58, insets.top + 2) }]}>
                <Pressable accessibilityLabel={drawerOpen ? 'Close account panel' : 'Open account panel'} accessibilityRole="button" accessibilityState={{ expanded: drawerOpen }} onPress={() => setDrawerOpen(value => !value)} style={styles.menuButton}>
                  <ListIcon size={24} color={colors.active} weight="regular" />
                </Pressable>
              </NavigationGestureBoundary>
            </View>
            <TabSlot style={styles.content} />
            <TabList style={styles.navigation}>
              <TabTrigger name="home" href="/" accessibilityLabel="Home" accessibilityRole="tab" accessibilityState={{ selected: !suggestionsActive }} style={[styles.tab, styles.homeTab]}>
                <HouseIcon size={24} weight={suggestionsActive ? 'regular' : 'fill'} color={suggestionsActive ? colors.inactive : colors.active} />
              </TabTrigger>
              <TabTrigger name="suggestions" href="/suggestions" accessibilityLabel="Suggestions" accessibilityRole="tab" accessibilityState={{ selected: suggestionsActive }} style={[styles.tab, styles.suggestionsTab]}>
                <LightbulbIcon size={28} weight="regular" color={suggestionsActive ? colors.active : colors.inactive} />
              </TabTrigger>
            </TabList>
            <View style={[styles.footer, { height: 40 + insets.bottom }]}><Text style={styles.contact}>Contact us</Text></View>
          </Tabs>
        </Animated.View>
      </View>
    </NavigationGestureContext.Provider>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', backgroundColor: colors.background },
  canvas: { flex: 1 },
  drawer: { position: 'absolute', left: 0, backgroundColor: '#101010', borderRadius: 40, paddingHorizontal: 26, paddingVertical: 76, justifyContent: 'space-between' },
  identity: { gap: 8 },
  accountDetails: { gap: 15 },
  name: { fontFamily: fonts.date, fontSize: 16, lineHeight: 22, color: colors.foreground },
  email: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.inactive },
  section: { gap: 9 },
  topicsSection: { marginTop: 35 },
  connectorsSection: { marginTop: 20 },
  sectionLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, color: '#6D6D6D' },
  topicChips: { gap: 6 },
  topicChip: { alignSelf: 'flex-start', minWidth: 66, paddingHorizontal: 18, height: 20, borderRadius: 12, backgroundColor: '#1D1D1D', justifyContent: 'center' },
  topicText: { fontFamily: fonts.regular, fontSize: 11, color: colors.foreground, textAlign: 'center' },
  addTopic: { alignSelf: 'flex-start', minWidth: 66, height: 20, paddingHorizontal: 15, borderRadius: 12, borderWidth: 1, borderColor: '#242424', justifyContent: 'center' },
  addTopicText: { fontFamily: fonts.regular, fontSize: 11, color: '#6D6D6D', textAlign: 'center' },
  topicMenu: { maxHeight: 120, borderRadius: 10, backgroundColor: '#191919' },
  topicOption: { minHeight: 32, paddingHorizontal: 14, justifyContent: 'center' },
  topicOptionText: { fontFamily: fonts.regular, fontSize: 12, color: colors.inactive },
  topicOptionSelected: { color: colors.foreground },
  connector: { width: 25, height: 25 },
  loggedOut: { flex: 1, justifyContent: 'center' },
  loginCopy: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#C8C8C8' },
  accountActions: { alignItems: 'center', gap: 16 },
  accountButton: { width: 112, height: 37, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  accountButtonText: { fontFamily: fonts.heading, fontSize: 16, lineHeight: 20, color: '#000000' },
  error: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.inactive },
  tabs: { flex: 1, backgroundColor: colors.background },
  header: { flexShrink: 0 },
  menu: { position: 'absolute', left: 13, width: 44, height: 44 },
  menuButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  navigation: { height: 44, flexShrink: 0, position: 'relative' },
  tab: { position: 'absolute', top: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  homeTab: { left: '22.388%', marginLeft: -22 },
  suggestionsTab: { left: '73.756%', marginLeft: -22 },
  footer: { alignItems: 'center', paddingTop: 12, flexShrink: 0 },
  contact: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 16, color: colors.footer, textAlign: 'center', width: 93, height: 26, includeFontPadding: false },
});
