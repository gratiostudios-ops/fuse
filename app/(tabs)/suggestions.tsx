import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../src/theme';
import { getUserSuggestions } from '../../api/user-suggestions';
import type { Suggestion } from '../../api/types';
import { useAuth } from '../../src/auth-context';

export default function SuggestionsScreen() {
  const { session } = useAuth();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) { setSuggestions([]); return; }
    let alive = true;
    setLoading(true); setError('');
    void getUserSuggestions(session.user.id).then(items => { if (alive) setSuggestions(items); })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load suggestions.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session?.user.id]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Suggestions</Text>
      <View style={styles.suggestions}>
        {!session && <Text style={styles.message}>Sign in to see your suggestions.</Text>}
        {loading && <ActivityIndicator color={colors.foreground} />}
        {!!error && <Text accessibilityRole="alert" style={styles.message}>{error}</Text>}
        {!loading && session && !error && !suggestions.length && <Text style={styles.message}>Your selected suggestions will appear here.</Text>}
        {suggestions.map(suggestion => <Pressable key={suggestion.id} accessibilityRole="link" onPress={() => void Linking.openURL(suggestion.video_url)} style={styles.card}>
          {suggestion.thumbnail_url ? <Image source={{ uri: suggestion.thumbnail_url }} style={styles.thumbnail} /> : <View style={styles.thumbnail} />}
          <View style={styles.details}><Text numberOfLines={2} style={styles.cardTitle}>{suggestion.title}</Text>{suggestion.duration_minutes !== null && <Text style={styles.duration}>{suggestion.duration_minutes} min</Text>}</View>
        </Pressable>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: 7, paddingBottom: 24 },
  title: { marginLeft: 26, height: 51, fontFamily: fonts.heading, fontSize: 28, lineHeight: 31, color: colors.heading, includeFontPadding: false },
  suggestions: { marginTop: 20, marginHorizontal: 26, gap: 14 },
  message: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.inactive },
  card: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumbnail: { width: 75, height: 63, borderRadius: 9, backgroundColor: '#1E1E1E' },
  details: { flex: 1, gap: 5 },
  cardTitle: { fontFamily: fonts.suggestionTitle, fontSize: 14, lineHeight: 19, color: colors.foreground },
  duration: { fontFamily: fonts.regular, fontSize: 12, color: colors.inactive },
});
