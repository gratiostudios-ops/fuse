import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowCircleRightIcon, CaretDownIcon } from 'phosphor-react-native';
import { colors, fonts } from '../../src/theme';

export default function HomeScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.organizer}>
        <Text style={styles.organizerLabel}>Organizer</Text>
        <CaretDownIcon size={17} color={colors.foreground} style={styles.caret} />
      </View>
      <View style={styles.blankBody} />
      <View style={styles.composer} accessibilityLabel="Chat composer, not yet available">
        <View style={styles.input}>
          <Text style={styles.placeholder}>Ask anything</Text>
          <View accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: true }}>
            <ArrowCircleRightIcon size={36} weight="fill" color="#E8E8E8" />
          </View>
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
  blankBody: { flex: 1, minHeight: 40 },
  composer: { height: 71, marginLeft: 16, marginRight: 17, paddingLeft: 9, paddingRight: 8, paddingTop: 10, paddingBottom: 9, backgroundColor: colors.composer, borderRadius: 33 },
  input: { height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.0784314)', paddingLeft: 16, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  placeholder: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 17, color: colors.placeholder, includeFontPadding: false },
});
