import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HouseIcon, LightbulbIcon, ListIcon } from 'phosphor-react-native';
import { colors, fonts } from '../../src/theme';

export default function TabLayout() {
  const pathname = usePathname();
  const suggestionsActive = pathname === '/suggestions';
  const insets = useSafeAreaInsets();

  return (
    <Tabs style={styles.tabs}>
      <View style={[styles.header, { height: Math.max(134, insets.top + 78) }]}>
        <Pressable
          accessibilityLabel="Google account"
          accessibilityRole="button"
          onPress={() => router.push('/sign-in')}
          style={[styles.menu, { top: Math.max(58, insets.top + 2) }]}
        >
          <ListIcon size={24} color={colors.active} weight="regular" />
        </Pressable>
      </View>
      <TabSlot style={styles.content} />
      <TabList style={styles.navigation}>
        <TabTrigger
            name="home"
            href="/"
            accessibilityLabel="Home"
            accessibilityRole="tab"
            accessibilityState={{ selected: !suggestionsActive }}
            style={[styles.tab, styles.homeTab]}
        >
          <HouseIcon size={24} weight={suggestionsActive ? 'regular' : 'fill'} color={suggestionsActive ? colors.inactive : colors.active} />
        </TabTrigger>
        <TabTrigger
            name="suggestions"
            href="/suggestions"
            accessibilityLabel="Suggestions"
            accessibilityRole="tab"
            accessibilityState={{ selected: suggestionsActive }}
            style={[styles.tab, styles.suggestionsTab]}
        >
          <LightbulbIcon size={28} weight="regular" color={suggestionsActive ? colors.active : colors.inactive} />
        </TabTrigger>
      </TabList>
      <View style={[styles.footer, { height: 40 + insets.bottom }]}>
        <Text style={styles.contact}>Contact us</Text>
      </View>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabs: { flex: 1, backgroundColor: colors.background },
  header: { flexShrink: 0 },
  menu: { position: 'absolute', left: 13, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  navigation: { height: 44, flexShrink: 0, position: 'relative' },
  tab: { position: 'absolute', top: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  homeTab: { left: '22.388%', marginLeft: -22 },
  suggestionsTab: { left: '73.756%', marginLeft: -22 },
  footer: { alignItems: 'center', paddingTop: 12, flexShrink: 0 },
  contact: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 16, color: colors.footer, textAlign: 'center', width: 93, height: 26, includeFontPadding: false },
});
