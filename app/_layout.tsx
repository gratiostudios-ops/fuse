import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_900Black } from '@expo-google-fonts/inter';
import { CrimsonPro_700Bold } from '@expo-google-fonts/crimson-pro';
import { Poppins_400Regular, Poppins_600SemiBold } from '@expo-google-fonts/poppins';
import { colors } from '../src/theme';
import { AuthProvider } from '../src/auth-context';
import { RefreshLifecycle } from '../src/refresh-lifecycle';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_900Black,
    CrimsonPro_700Bold,
    Poppins_400Regular,
    Poppins_600SemiBold,
  });

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  if (error) throw error;
  if (!loaded) return null;

  return (
    <View style={styles.background}>
      <StatusBar hidden />
      <View style={styles.shell}>
        <AuthProvider>
          <RefreshLifecycle />
          <Slot />
        </AuthProvider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: colors.background, alignItems: 'center' },
  shell: { flex: 1, width: '100%', maxWidth: 402 },
});
