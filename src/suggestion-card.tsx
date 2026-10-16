import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts } from './theme';
import { NavigationGestureBoundary } from './navigation-gestures';

export type SuggestionCardData = {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  description?: string | null;
};

export function SuggestionCard({ suggestion }: { suggestion: SuggestionCardData }) {
  return <NavigationGestureBoundary style={styles.container}>
    <Pressable accessibilityRole="link" accessibilityLabel={suggestion.title}
      onPress={() => { void Linking.openURL(suggestion.video_url).catch(reason => console.warn('Suggestion link unavailable', reason)); }} style={styles.row}>
      {suggestion.thumbnail_url ? <Image source={{ uri: suggestion.thumbnail_url }} resizeMode="cover" style={styles.thumbnail} /> : <View style={styles.thumbnail} />}
      <View style={styles.details}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{suggestion.title}</Text>
        {!!suggestion.description && <Text numberOfLines={2} ellipsizeMode="tail" style={styles.description}>{suggestion.description}</Text>}
      </View>
    </Pressable>
    <View style={styles.divider} />
  </NavigationGestureBoundary>;
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  row: { minHeight: 63, flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  thumbnail: { width: 75, height: 63, borderRadius: 9, backgroundColor: '#1E1E1E' },
  details: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.suggestionTitle, fontSize: 14, lineHeight: 20, color: '#D4D4D4', includeFontPadding: false },
  description: { fontFamily: fonts.suggestionBody, fontSize: 12, lineHeight: 18, color: '#B5B5B5', includeFontPadding: false },
  divider: { marginLeft: 28, height: 1, backgroundColor: '#1D1D1D' },
});
