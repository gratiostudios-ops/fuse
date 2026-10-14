import { getCachedUserSuggestions } from '../../api/suggestion-cache';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../src/theme';
import { getUserSuggestions, getReceivedSuggestions, subscribeUserSuggestions, retrySuggestionReceipts, type UserSuggestion } from '../../api/user-suggestions';
import { SuggestionCard } from '../../src/suggestion-card';
import { useAuth } from '../../src/auth-context';

export default function SuggestionsScreen() {
  const { session } = useAuth();
  const [feed, setFeed] = useState<{ userId: string | null; items: UserSuggestion[] }>({ userId: null, items: [] });
  const userId = session?.user.id ?? null;
  const suggestions = feed.userId === userId ? feed.items : [];
  const [loading, setLoading] = useState(false);

  const focused = useIsFocused();
  useEffect(() => {
    if (!userId) { setFeed({ userId: null, items: [] }); setLoading(false); return; }
    let alive = true;
    let sequence = 0;
    const owner = userId;
    const update = async () => {
      const current = ++sequence;
      const local = getReceivedSuggestions(owner);
      if (alive) setFeed(previous => ({ userId: owner, items: [...new Map([...local, ...(previous.userId === owner ? previous.items : [])].map(item => [item.id, item])).values()] }));
      try {
        const saved = await getUserSuggestions(owner);
        if (alive && sequence === current) setFeed({ userId: owner, items: [...new Map([...getReceivedSuggestions(owner), ...saved].map(item => [item.id, item])).values()] });
      } catch (reason) { console.warn('Saved suggestions unavailable', reason); }
      finally { if (alive) setLoading(false); }
    };
    const unsubscribe = subscribeUserSuggestions(() => { void update(); });
    void getCachedUserSuggestions(owner).then(cached => {
      if (!alive) return;
      if (sequence === 0) setFeed(previous => ({ userId: owner, items: [...new Map([
        ...cached, ...(previous.userId === owner ? previous.items : []), ...getReceivedSuggestions(owner),
      ].map(item => [item.id, item])).values()] }));
      if (focused) {
        setLoading(true);
        void retrySuggestionReceipts(owner);
        void update();
      }
    });
    return () => { alive = false; unsubscribe(); };
  }, [userId, focused]);

  const groups = new Map<string, UserSuggestion[]>();
  const ordered = [...suggestions].sort((a, b) => (b.recommended_at ?? '').localeCompare(a.recommended_at ?? ''));
  for (const suggestion of ordered) {
    const date = new Date(suggestion.recommended_at);
    const valid = Number.isFinite(date.getTime());
    const key = valid ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : 'undated';
    const items = groups.get(key) ?? [];
    items.push(suggestion);
    groups.set(key, items);
  }
  const dateLabel = (value: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? `${String(date.getDate()).padStart(2, '0')} ${date.toLocaleDateString('en-GB', { month: 'short' })}` : '';
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Suggestions</Text>
      <View style={styles.suggestions}>
        {!session && <Text style={styles.message}>Sign in to see your suggestions.</Text>}
        {loading && !suggestions.length && <ActivityIndicator color={colors.foreground} />}
        {!loading && session && !suggestions.length && <Text style={styles.message}>Your selected suggestions will appear here.</Text>}
        {[...groups].map(([date, items]) => <View key={date} style={styles.group}>
          {!!dateLabel(items[0].recommended_at) && <Text style={styles.date}>{dateLabel(items[0].recommended_at)}</Text>}
          <View style={styles.rows}>{items.map(suggestion => <SuggestionCard key={suggestion.id} suggestion={suggestion} />)}</View>
        </View>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: 7, paddingBottom: 24 },
  title: { marginLeft: 26, height: 51, fontFamily: fonts.heading, fontSize: 28, lineHeight: 31, color: colors.heading, includeFontPadding: false },
  suggestions: { marginTop: 34, marginLeft: 40, marginRight: 41, gap: 35 },
  message: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.inactive },
  group: { gap: 14 },
  date: { marginLeft: -2, fontFamily: fonts.date, fontSize: 12, lineHeight: 15, color: '#B5B5B5', includeFontPadding: false },
  rows: { gap: 29 },
});
