import { KeyboardVisibilityContext, useKeyboardLayout } from '../../src/keyboard-layout';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, BackHandler, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useNavigationMotion } from '../../src/navigation-motion';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon, HouseIcon, LightbulbIcon, ListIcon } from 'phosphor-react-native';
import { signInWithGoogle, signOut } from '../../api/auth';
import { claimGoogleSignInNavigation } from '../../api/auth/google';
import { getTopics } from '../../api/topics';
import type { Topic } from '../../api/types';
import { getUserTopicIds, setUserTopicIds } from '../../api/user-topics';
import { getRefreshTopicIds, setRefreshTopicIds } from '../../refresh';
import { useAuth } from '../../src/auth-context';
import { NavigationGestureBoundary, NavigationGestureContext } from '../../src/navigation-gestures';
import { colors, fonts } from '../../src/theme';

export default function TabLayout() {
  const { visible: keyboardVisible, webHeight } = useKeyboardLayout();
  const pathname = usePathname();
  const suggestionsActive = pathname === '/suggestions';
  const insets = useSafeAreaInsets();
  const headerHeight = Math.max(134, insets.top + 78);
  const { session, loading, error: authError } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [width, setWidth] = useState(402);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  const drawerWidth = Math.min(230, width * 230 / 402);
  const changePage = useCallback((suggestions: boolean) => {
    router.navigate(suggestions ? '/suggestions' : '/');
  }, []);
  const motion = useNavigationMotion({ width, panelWidth: drawerWidth, panelOpen: drawerOpen, suggestions: suggestionsActive, reduceMotion, onPanelChange: setDrawerOpen, onPageChange: changePage });
  useEffect(() => { if (error || authError) console.warn('Account action unavailable', error || authError); }, [error, authError]);
  const metadata = session?.user.user_metadata;
  const name = metadata?.full_name || metadata?.name || session?.user.email?.split('@')[0] || 'Account';

  useEffect(() => {
    if (!drawerOpen) return;
    Keyboard.dismiss();
    if (Platform.OS === 'web' && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [drawerOpen]);
  useEffect(() => { setDrawerOpen(false); setError(null); }, [session?.user.id]);
  useEffect(() => {
    if (!drawerOpen || !motion.panelSettled || !session) return;
    let alive = true;
    void Promise.all([getTopics(), getUserTopicIds(session.user.id)]).then(([catalog, selected]) => {
      if (alive) { setTopics(catalog); setTopicIds(selected); }
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load topics.'); });
    return () => { alive = false; };
  }, [drawerOpen, motion.panelSettled, session]);
  useEffect(() => {
    if (!drawerOpen) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { setDrawerOpen(false); return true; });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false); };
    if (Platform.OS === 'web') window.addEventListener('keydown', escape);
    return () => { back.remove(); if (Platform.OS === 'web') window.removeEventListener('keydown', escape); };
  }, [drawerOpen]);

  async function accountAction() {
    setBusy(true); setError(null);
    try {
      if (session) {
        await signOut(); setDrawerOpen(false); router.replace('/');
      } else {
        const result = await signInWithGoogle();
        if (result.status === 'cancelled') setError('Sign-in cancelled. You can try again.');
        if (result.status === 'signed-in' && claimGoogleSignInNavigation()) { setDrawerOpen(false); router.replace('/'); }
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update your account.'); }
    finally { setBusy(false); }
  }

  async function toggleTopic(topicId: string) {
    const next = topicIds.includes(topicId) ? topicIds.filter(id => id !== topicId) : [...topicIds, topicId];
    setTopicIds(next);
    setTopicsOpen(false);
    try { await setUserTopicIds(next); await setRefreshTopicIds(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save topics.'); }
  }

  return (
    <KeyboardVisibilityContext.Provider value={keyboardVisible}>
    <NavigationGestureContext.Provider value={motion.gesture}>
    <GestureDetector gesture={motion.gesture}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined} style={[styles.frame, webHeight !== null && { flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: webHeight, height: webHeight }]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        <Animated.View pointerEvents={drawerOpen ? 'auto' : 'none'} accessibilityElementsHidden={!drawerOpen} importantForAccessibility={drawerOpen ? 'auto' : 'no-hide-descendants'} accessibilityLabel="Account panel" style={[styles.drawer, motion.panelStyle, { width: drawerWidth, top: Math.max(52, insets.top + 16), bottom: 100 + insets.bottom }]}>
          {session ? <View style={styles.accountDetails}>
            <View style={styles.identity}>
              <Text style={styles.name}>{String(name)}</Text>
              <Text style={styles.email}>{session.user.email ?? ''}</Text>
            </View>
            <NavigationGestureBoundary style={[styles.section, styles.topicsSection]}>
              <Text style={styles.sectionLabel}>Topics</Text>
              <View style={styles.topicChips}>{topics.filter(topic => topicIds.includes(topic.id)).map(topic => <Pressable key={topic.id} accessibilityRole="button" onPress={() => void toggleTopic(topic.id)} style={styles.topicChip}><Text style={styles.topicText}>{topic.name}</Text></Pressable>)}</View>
              <Pressable accessibilityRole="button" accessibilityLabel="Add topic" onPress={() => setTopicsOpen(value => !value)} style={styles.addTopic}><Text style={styles.addTopicText}>Add +</Text></Pressable>
              {topicsOpen && <ScrollView style={styles.topicMenu} nestedScrollEnabled>{topics.map(topic => {
                const selected = topicIds.includes(topic.id);
                return <Pressable key={topic.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => void toggleTopic(topic.id)} style={styles.topicOption}>
                  <Text style={[styles.topicOptionText, selected && styles.topicOptionSelected]}>{topic.name}</Text>
                  <View style={[styles.topicCheckbox, selected && styles.topicCheckboxSelected]}>{selected && <CheckIcon size={12} color="#101010" weight="bold" />}</View>
                </Pressable>;
              })}</ScrollView>}
            </NavigationGestureBoundary>
            <View style={[styles.section, styles.connectorsSection]}>
              <Text style={styles.sectionLabel}>Connectors</Text>
              <View style={styles.calendarConnector}>
                <Svg accessibilityLabel="Google Calendar" width={34.2} height={34.2} viewBox="0 0 76 76" role="img" style={styles.connector}>
                  <Path fill="#fff" d="M58 18H18v40h40z" />
                  <Path fill="#ea4335" d="M58 76l18-18H58z" />
                  <Path fill="#fbbc04" d="M76 18H58v40h18z" />
                  <Path fill="#34a853" d="M58 58H18v18h40z" />
                  <Path fill="#188038" d="M0 58v12c0 3.315 2.685 6 6 6h12V58z" />
                  <Path fill="#1967d2" d="M76 18V6c0-3.315-2.685-6-6-6H58v18z" />
                  <Path fill="#4285f4" d="M58 0H6C2.685 0 0 2.685 0 6v52h18V18h40z" />
                  <Path fill="#4285f4" d="M26.205 49.03c-1.495-1.01-2.53-2.485-3.095-4.435l3.47-1.43c.315 1.2.865 2.13 1.65 2.79.78.66 1.73.985 2.84.985 1.135 0 2.11-.345 2.925-1.035s1.225-1.57 1.225-2.635c0-1.09-.43-1.98-1.29-2.67-.86-.69-1.94-1.035-3.23-1.035h-2.005V36.13h1.8c1.11 0 2.045-.3 2.805-.9.76-.6 1.14-1.42 1.14-2.465 0-.93-.34-1.67-1.02-2.225-.68-.555-1.54-.835-2.585-.835-1.02 0-1.83.27-2.43.815a4.784 4.784 0 00-1.31 2.005l-3.435-1.43c.455-1.29 1.29-2.43 2.515-3.415 1.225-.985 2.79-1.48 4.69-1.48 1.405 0 2.67.27 3.79.815 1.12.545 2 1.3 2.635 2.26.635.965.95 2.045.95 3.245 0 1.225-.295 2.26-.885 3.11-.59.85-1.315 1.5-2.175 1.955v.205a6.605 6.605 0 012.79 2.175c.725.975 1.09 2.14 1.09 3.5 0 1.36-.345 2.575-1.035 3.64S36.38 49.01 35.17 49.62c-1.215.61-2.58.92-4.095.92-1.755.005-3.375-.5-4.87-1.51zM47.52 31.81l-3.81 2.755-1.905-2.89 6.835-4.93h2.62V50h-3.74z" />
                </Svg>
                <View accessibilityLabel="Fuse connector" style={[styles.emptyConnector, styles.imageConnector]}>
                  <Image source={require('../../assets/connectors/connector-mark.png')} accessibilityLabel="Fuse connector" resizeMode="contain" style={styles.connectorMark} />
                </View>
                <View accessibilityLabel="Empty connector" style={styles.emptyConnector} />
                <View accessibilityLabel="Empty connector" style={styles.emptyConnector} />
              </View>
            </View>
          </View> : <View style={styles.loggedOut}><Text style={styles.loginCopy}>login for full experience of{`\n`}the application</Text></View>}
          <NavigationGestureBoundary style={styles.accountActions}>
            <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => void accountAction()} style={styles.accountButton}>
              {busy || loading ? <ActivityIndicator color={colors.foreground} /> : <Text style={styles.accountButtonText}>{session ? 'logout' : 'login'}</Text>}
            </Pressable>
          </NavigationGestureBoundary>
        </Animated.View>
        <Tabs style={styles.tabs} pointerEvents="box-none">
          {/* Expo Router discovers screens only from a direct TabList. */}
          <TabList style={{ display: 'none' }}>
            <TabTrigger name="home" href="/" />
            <TabTrigger name="suggestions" href="/suggestions" />
          </TabList>
          <Animated.View style={[styles.canvas, motion.canvasStyle]}>
            <View style={styles.canvas}>
            <View style={[styles.header, { height: headerHeight }]}>
              <NavigationGestureBoundary style={[styles.menu, { top: Math.max(58, insets.top + 2) }]}>
                <Pressable accessibilityLabel={drawerOpen ? 'Close account panel' : 'Open account panel'} accessibilityRole="button" accessibilityState={{ expanded: drawerOpen }} onPress={() => setDrawerOpen(value => !value)} style={styles.menuButton}>
                  <ListIcon size={24} color={colors.active} weight="regular" />
                </Pressable>
              </NavigationGestureBoundary>
            </View>
            <TabSlot style={[styles.content, { overflow: 'hidden' }]} detachInactiveScreens={false} renderFn={(descriptor, { isFocused }) => (
              <Animated.View key={descriptor.route.key} pointerEvents={isFocused && !drawerOpen ? 'auto' : 'none'}
                accessibilityElementsHidden={!isFocused || drawerOpen} importantForAccessibility={isFocused && !drawerOpen ? 'auto' : 'no-hide-descendants'}
                style={[StyleSheet.absoluteFill, descriptor.route.name === 'suggestions' ? motion.suggestionsStyle : motion.homeStyle]}>
                {descriptor.render()}
              </Animated.View>
            )} />
            </View>
            <View style={[styles.navigation, keyboardVisible && { display: 'none' }]}>
              <TabTrigger name="home" href="/" accessibilityLabel="Home" accessibilityRole="tab" accessibilityState={{ selected: !suggestionsActive }} style={[styles.tab, styles.homeTab]}>
                <HouseIcon size={24} weight={suggestionsActive ? 'regular' : 'fill'} color={suggestionsActive ? colors.inactive : colors.active} />
              </TabTrigger>
              <TabTrigger name="suggestions" href="/suggestions" accessibilityLabel="Suggestions" accessibilityRole="tab" accessibilityState={{ selected: suggestionsActive }} style={[styles.tab, styles.suggestionsTab]}>
                <LightbulbIcon size={28} weight="regular" color={suggestionsActive ? colors.active : colors.inactive} />
              </TabTrigger>
            </View>
            <View style={[styles.footer, { height: 40 + insets.bottom }, keyboardVisible && { display: 'none' }]}><Text style={styles.contact}>Contact us</Text></View>
            <Animated.View accessibilityElementsHidden={!drawerOpen} importantForAccessibility={drawerOpen ? 'auto' : 'no-hide-descendants'} pointerEvents={drawerOpen ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { top: headerHeight, zIndex: 2 }, motion.panelStyle]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close account panel" onPress={() => setDrawerOpen(false)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} />
            </Animated.View>
          </Animated.View>
        </Tabs>
      </KeyboardAvoidingView>
    </GestureDetector>
    </NavigationGestureContext.Provider>
    </KeyboardVisibilityContext.Provider>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', backgroundColor: colors.background },
  canvas: { flex: 1, backgroundColor: colors.background },
  drawer: { position: 'absolute', left: 0, backgroundColor: '#101010', borderRadius: 40, paddingHorizontal: 26, paddingTop: 70, paddingBottom: 76, justifyContent: 'space-between' },
  identity: { gap: 4 },
  accountDetails: { gap: 15 },
  name: { fontFamily: fonts.date, fontSize: 19, lineHeight: 25, color: colors.foreground },
  email: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.inactive },
  section: { gap: 9 },
  topicsSection: { marginTop: 35 },
  connectorsSection: { marginTop: 20 },
  sectionLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, color: '#6D6D6D' },
  topicChips: { gap: 6 },
  topicChip: { alignSelf: 'flex-start', minWidth: 66, paddingHorizontal: 18, height: 20, borderRadius: 12, backgroundColor: '#1D1D1D', justifyContent: 'center' },
  topicText: { fontFamily: fonts.regular, fontSize: 12, color: colors.foreground, textAlign: 'center' },
  addTopic: { alignSelf: 'flex-start', minWidth: 66, height: 20, paddingHorizontal: 15, borderRadius: 12, borderWidth: 1, borderColor: '#242424', justifyContent: 'center' },
  addTopicText: { fontFamily: fonts.regular, fontSize: 11, color: '#6D6D6D', textAlign: 'center' },
  topicMenu: { maxHeight: 120, borderRadius: 10, backgroundColor: '#191919' },
  topicOption: { minHeight: 32, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topicOptionText: { fontFamily: fonts.regular, fontSize: 12, color: colors.inactive },
  topicOptionSelected: { color: colors.foreground },
  topicCheckbox: { width: 16, height: 16, borderWidth: 1, borderColor: '#6D6D6D', borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  topicCheckboxSelected: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  calendarConnector: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  connector: { width: 34.2, height: 34.2 },
  emptyConnector: { width: 34.2, height: 34.2, borderRadius: 7.2, backgroundColor: '#353535' },
  imageConnector: { backgroundColor: 'transparent', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  connectorMark: { width: '100%', height: '100%' },
  loggedOut: { justifyContent: 'flex-start' },
  loginCopy: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#C8C8C8' },
  accountActions: { alignItems: 'center', gap: 16 },
  accountButton: { width: 112, height: 37, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  accountButtonText: { fontFamily: fonts.heading, fontSize: 16, lineHeight: 20, color: '#000000' },
  error: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.inactive },
  tabs: { flex: 1 },
  header: { flexShrink: 0 },
  menu: { position: 'absolute', left: 13, width: 44, height: 44 },
  menuButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  navigation: { backgroundColor: colors.background, height: 44, flexShrink: 0, position: 'relative' },
  tab: { position: 'absolute', top: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  homeTab: { left: '22.388%', marginLeft: -22 },
  suggestionsTab: { left: '73.756%', marginLeft: -22 },
  footer: { backgroundColor: colors.background, alignItems: 'center', paddingTop: 12, flexShrink: 0 },
  contact: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 16, color: colors.footer, textAlign: 'center', width: 93, height: 26, includeFontPadding: false },
});
