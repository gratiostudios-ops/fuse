import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ImageIcon } from 'phosphor-react-native';
import { colors, fonts } from '../../src/theme';
import { useAuth } from '../../src/auth-context';
import { subscribeRefresh } from '../../refresh/cache';
import { getLatestRefresh } from '../../refresh/runtime';
import { subscribeTopicChanges } from '../../refresh/topics';
import type { RefreshSnapshot } from '../../refresh/types';

export default function SuggestionsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [snapshot, setSnapshot] = useState<RefreshSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let revision = 0;
    setSnapshot(null);
    setError('');
    const update = async () => {
      const request = ++revision;
      try {
        const record = await getLatestRefresh();
        if (alive && request === revision) { setSnapshot(record?.snapshot ?? null); setError(''); }
      } catch {
        if (alive && request === revision) setError('Could not load refreshed items. Please refresh again.');
      }
    };
    const unsubscribe = subscribeRefresh(() => { void update(); });
    const unsubscribeTopics = subscribeTopicChanges(() => { setSnapshot(null); void update(); });
    void update();
    return () => { alive = false; unsubscribe(); unsubscribeTopics(); };
  }, [userId]);
  const current = snapshot?.userId === userId ? snapshot : null;
  const suggestions = current?.suggestions.data.filter(item => item.is_active) ?? [];
  const tasks = current?.tasks.data.filter(item => item.user_id === userId) ?? [];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Suggestions</Text>
      <View style={styles.suggestions}>
        {!!error && <Text accessibilityRole="alert" style={styles.detail}>{error}</Text>}
        {!current && !error && <Text style={styles.detail}>Use Refresh on Home to load suggestions and tasks.</Text>}
        {current && <>
          {['error', 'partial', 'authentication-required'].includes(current.suggestions.status) && <Text accessibilityRole="alert" style={styles.detail}>Some suggestions could not be loaded. Please refresh again.</Text>}
          {!suggestions.length && <Text style={styles.detail}>{current.suggestions.status === 'no-topics' ? 'No suggestion topics selected yet.' : 'No suggestions available.'}</Text>}
          {suggestions.map(item => <Pressable key={item.id} style={styles.row} accessibilityRole="link" accessibilityLabel={'Watch ' + item.title}
            onPress={() => {
              if (/^https?:\/\//i.test(item.video_url)) void Linking.openURL(item.video_url).catch(() => setError('Could not open this video.'));
            }}>
            <View style={styles.thumbnail}>
              {item.thumbnail_url ? <Image source={{ uri: item.thumbnail_url }} style={styles.image} accessibilityLabel={item.title} /> : <ImageIcon size={26} weight="light" color={colors.inactive} />}
            </View>
            <View style={styles.details}>
              <Text style={styles.name}>{item.title}</Text>
              {!!item.description && <Text numberOfLines={2} style={styles.detail}>{item.description}</Text>}
              {item.duration_minutes !== null && <Text style={styles.detail}>{item.duration_minutes} min</Text>}
            </View>
          </Pressable>)}
          <Text accessibilityRole="header" style={styles.section}>Tasks</Text>
          {['error', 'partial', 'authentication-required'].includes(current.tasks.status) && <Text accessibilityRole="alert" style={styles.detail}>Tasks could not be fully loaded. Please refresh again.</Text>}
          {!tasks.length && <Text style={styles.detail}>{userId ? 'No tasks available.' : 'Sign in to see your tasks.'}</Text>}
          {tasks.map(item => <View key={item.id} style={styles.task}>
            <Text style={styles.name}>{item.title}</Text>
            {!!item.description && <Text numberOfLines={2} style={styles.detail}>{item.description}</Text>}
            <Text style={styles.detail}>{item.mark_completed ? 'Completed' : 'Pending'} · Due {item.due_date}{item.due_time ? ' at ' + item.due_time.slice(0, 5) : ''}</Text>
          </View>)}
        </>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: 7, paddingBottom: 24 },
  title: { marginLeft: 26, height: 51, fontFamily: fonts.heading, fontSize: 28, lineHeight: 31, color: colors.heading, includeFontPadding: false },
  suggestions: { marginTop: 24, marginHorizontal: 26, gap: 18 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  image: { width: '100%', height: '100%' },
  details: { flex: 1, gap: 5 },
  name: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.foreground },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.placeholder },
  section: { marginTop: 12, fontFamily: fonts.medium, fontSize: 18, color: colors.foreground },
  task: { padding: 14, borderRadius: 10, backgroundColor: colors.composer, gap: 5 },
  thumbnail: { width: 75, height: 63, borderRadius: 9, backgroundColor: '#1E1E1E', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
