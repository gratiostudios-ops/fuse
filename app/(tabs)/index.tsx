import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowCircleRightIcon, CaretDownIcon } from 'phosphor-react-native';
import { colors, fonts } from '../../src/theme';
import { askAI, type FuseResponse } from '../../api/ai';
import { useAuth } from '../../src/auth-context';
import { useOrganizer, OrganizerList, DailyRecapView } from '../../src/organizer';
import { FuseResponseView } from '../../src/fuse-response';
import { getLatestRefresh, initializeRefreshRuntime, refreshNow } from '../../refresh/runtime';
import { subscribeRefresh } from '../../refresh/cache';
import { parseFuseResponse } from '../../supabase/functions/_shared/contract';

export default function HomeScreen() {
  const [message, setMessage] = useState('');
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

  useEffect(() => {
    let alive = true;
    setMessages([]);
    setMessage('');
    setError('');
    setHome(null);
    setHomeError('');
    if (!userId) { setHomeLoading(false); return; }
    const update = async () => {
      const record = await getLatestRefresh();
      if (!alive || identity.current !== userId) return;
      const response = record?.processing.status === 'completed' ? record.processing.response : undefined;
      setHome(response ? parseFuseResponse(response) : null);
      setHomeError(record?.processing.status === 'error' ? record.processing.error : '');
    };
    const unsubscribe = subscribeRefresh(() => { void update().catch(() => {}); });
    setHomeLoading(true);
    void initializeRefreshRuntime().run().then(async result => {
      await update();
      if (alive && result.status === 'failed') setHomeError(result.reason ?? 'Could not refresh Home.');
    }).catch(err => { if (alive) setHomeError(err instanceof Error ? err.message : 'Could not refresh Home.'); })
      .finally(() => { if (alive) setHomeLoading(false); });
    return () => { alive = false; unsubscribe(); };
  }, [userId]);

  async function reloadHome() {
    if (homeLoading) return;
    const owner = userId;
    setHomeLoading(true);
    setHomeError('');
    try {
      const result = await refreshNow();
      if (identity.current === owner && result.status === 'failed') setHomeError(result.reason ?? 'Could not refresh Home.');
    } catch (err) {
      if (identity.current === owner) setHomeError(err instanceof Error ? err.message : 'Could not refresh Home.');
    } finally { if (identity.current === owner) setHomeLoading(false); }
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);

  async function sendMessage() {
    const input = message.trim();
    if (!input || sending.current) return;
    const owner = userId;
    sending.current = true;
    setLoading(true);
    setError('');
    try {
      const reply = await askAI(input, messages.map(({ role, text }) => ({ role, text })));
      if (identity.current !== owner) return;
      setMessages(previous => [...previous, { role: 'user', text: input }, { role: 'assistant', text: reply.message, response: reply }]);
      setMessage('');
    } catch (err) {
      if (identity.current === owner) setError(err instanceof Error ? err.message : 'Unable to reach Fuse AI. Please try again.');
    } finally {
      sending.current = false;
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" accessibilityLabel="Organizer" accessibilityState={{ expanded: organizerExpanded }} onPress={() => setOrganizerExpanded(value => !value)} style={styles.organizer}>
        <Text style={styles.organizerLabel}>Organizer</Text>
        <CaretDownIcon size={17} color={colors.foreground} style={[styles.caret, organizerExpanded && { transform: [{ rotate: '180deg' }] }]} />
      </Pressable>
      {!!userId && <OrganizerList controller={organizer} expanded={organizerExpanded} />}
      <View style={styles.blankBody}>
        <View style={styles.homeHeader}>
          <Text style={styles.messageLabel}>For you</Text>
          {!!userId && <Pressable accessibilityRole="button" disabled={homeLoading} onPress={reloadHome}><Text style={styles.messageLabel}>Refresh</Text></Pressable>}
        </View>
        {!!userId && <DailyRecapView controller={organizer} />}
        {!userId && <Text style={styles.messageText}>Sign in from the account menu to see your tasks and events.</Text>}
        {homeLoading && <Text style={styles.messageText}>Updating Home…</Text>}
        {!!userId && home && <FuseResponseView response={home} />}
        {!!homeError && <Text accessibilityRole="alert" style={styles.messageText}>{homeError}</Text>}

        {messages.map((item, index) => (
          <View key={index} style={styles.message}>
            <Text style={styles.messageLabel}>{item.role === 'user' ? 'You' : 'Fuse'}</Text>
            {item.response ? <FuseResponseView response={item.response} /> : <Text style={styles.messageText}>{item.text}</Text>}
          </View>
        ))}
        {loading && <Text style={styles.messageText}>Thinking…</Text>}
        {!!error && <Text accessibilityRole="alert" style={styles.messageText}>{error}</Text>}
      </View>
      <View style={styles.composer} accessibilityLabel="Chat composer">
        <View style={styles.input}>
          <TextInput style={styles.placeholder} placeholder="Ask anything" placeholderTextColor={colors.placeholder}
            accessibilityLabel="Message to Fuse AI" value={message} onChangeText={setMessage}
            maxLength={2000} editable={!loading} returnKeyType="send" onSubmitEditing={sendMessage} />
          <Pressable accessibilityRole="button" accessibilityLabel="Send message"
            disabled={loading || !message.trim()} onPress={sendMessage}>
            <ArrowCircleRightIcon size={36} weight="fill" color={loading || !message.trim() ? '#E8E8E8' : colors.foreground} />
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, minHeight: 180, paddingBottom: 7 },
  organizer: { height: 31, marginLeft: 24, marginRight: 25, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: 'row', justifyContent: 'space-between' },
  organizerLabel: { marginLeft: 3, fontFamily: fonts.medium, fontSize: 14, lineHeight: 17, color: colors.foreground, includeFontPadding: false },
  caret: { marginTop: 5, marginRight: 4 },
  blankBody: { flex: 1, minHeight: 40, padding: 24, gap: 16 },
  homeHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  message: { gap: 4 },
  messageLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.placeholder },
  messageText: { fontFamily: fonts.regular, fontSize: 14, color: colors.foreground },
  composer: { height: 71, marginLeft: 16, marginRight: 17, paddingLeft: 9, paddingRight: 8, paddingTop: 10, paddingBottom: 9, backgroundColor: colors.composer, borderRadius: 33 },
  input: { height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.0784314)', paddingLeft: 16, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  placeholder: { flex: 1, marginRight: 8, fontFamily: fonts.regular, fontSize: 14, color: colors.foreground, includeFontPadding: false },
});
