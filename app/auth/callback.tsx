import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { claimGoogleSignInNavigation, completeGoogleSignIn, getGoogleRedirectUri } from '../../api/auth/google';
import { colors, fonts } from '../../src/theme';

const ALLOWED_PARAMS = ['code', 'error', 'error_description'];

// Builds the callback URL without using URL / URLSearchParams.set,
// which can throw on some React Native setups.
function buildCallbackHref(params: Record<string, unknown>): string {
  const query = Object.entries(params)
    .filter(([key, value]) => typeof value === 'string' && ALLOWED_PARAMS.includes(key))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
    .join('&');
  const base = getGoogleRedirectUri();
  if (!query) return base;
  return `${base}${base.includes('?') ? '&' : '?'}${query}`;
}

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    // Everything runs inside the async function, so synchronous throws
    // (bad URL, undefined import, etc.) are caught by .catch below.
    (async () => {
      const href = buildCallbackHref(params);
      await completeGoogleSignIn(href);
      if (alive && claimGoogleSignInNavigation()) router.replace('/');
    })().catch(reason => {
      console.warn('Google sign-in callback failed', reason);
      if (alive) setError(reason instanceof Error ? reason.message : 'Could not complete Google sign-in.');
    });

    return () => { alive = false; };
  }, [params.code, params.error, params.error_description]);

  return (
    <View style={styles.screen}>
      {!error && <ActivityIndicator color={colors.foreground} />}
      <Text accessibilityRole="text" style={styles.text}>
        {error ? '' : 'Connecting your Google account…'}
      </Text>
      {error && (
        <Pressable accessibilityRole="button" onPress={() => router.replace('/sign-in')} style={styles.button}>
          <Text style={styles.text}>Back to sign-in</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 26 },
  text: { fontFamily: fonts.regular, color: colors.foreground, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 44, justifyContent: 'center' },
});