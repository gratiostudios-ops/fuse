import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ImageIcon } from 'phosphor-react-native';
import { colors, fonts } from '../../src/theme';

export default function SuggestionsScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Suggestions</Text>
      {/* Backend-provided suggestion rows will occupy this area later. */}
      <View style={styles.suggestions}>
        <View style={styles.thumbnail} accessible accessibilityRole="image" accessibilityLabel="Demo suggestion thumbnail">
          <ImageIcon size={26} weight="light" color={colors.inactive} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: 7, paddingBottom: 24 },
  title: { marginLeft: 26, height: 51, fontFamily: fonts.heading, fontSize: 28, lineHeight: 31, color: colors.heading, includeFontPadding: false },
  suggestions: { marginTop: 64, marginLeft: 40, marginRight: 40 },
  thumbnail: { width: 75, height: 63, borderRadius: 9, backgroundColor: '#1E1E1E', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
