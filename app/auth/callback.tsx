import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { completeGoogleSignIn, getGoogleRedirectUri } from '../../api/auth/google';
import { colors, fonts } from '../../src/theme';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const url = new URL(getGoogleRedirectUri());
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && ['code', 'error', 'error_description'].includes(key)) url.searchParams.set(key, value);
    }
    void completeGoogleSignIn(url.href).then(() => {
      if (alive) router.replace('/sign-in');
    }).catch(reason => {
      if (alive) setError(reason instanceof Error ? reason.message : 'Could not complete Google sign-in.');
    });
    return () => { alive = false; };
  }, [params.code, params.error, params.error_description]);

  return (
    <View style={styles.screen}>
      {!error && <ActivityIndicator color={colors.foreground} />}
      <Text accessibilityRole={error ? 'alert' : 'text'} style={styles.text}>{error ?? 'Connecting your Google account…'}</Text>
      {error && <Pressable accessibilityRole="button" onPress={() => router.replace('/sign-in')} style={styles.button}>
        <Text style={styles.text}>Back to sign-in</Text>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 26 },
  text: { fontFamily: fonts.regular, color: colors.foreground, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 44, justifyContent: 'center' },
});
