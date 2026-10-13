import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoogleLogoIcon } from 'phosphor-react-native';
import { signInWithGoogle, signOut } from '../api/auth';
import { useAuth } from '../src/auth-context';
import { colors, fonts } from '../src/theme';

export default function SignInScreen() {
  const { session, loading, error: initializationError } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await signInWithGoogle();
      if (result.status === 'cancelled') setMessage('Sign-in cancelled. You can try again.');
      if (result.status === 'signed-in') router.replace('/sign-in');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect your Google account.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try { await signOut(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign out.'); }
    finally { setBusy(false); }
  }

  return (
    <View style={[styles.screen, { paddingTop: Math.max(58, insets.top + 16), paddingBottom: insets.bottom + 24 }]}>
      <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>Your Google account</Text>
        <Text style={styles.description}>
          {session ? `Signed in as ${session.user.email ?? 'your Google account'}.` : 'Connect Google to access your tasks and allow read-only access to your calendar events.'}
        </Text>
        {loading ? <ActivityIndicator color={colors.foreground} /> : (
          <Pressable accessibilityRole="button" disabled={busy} onPress={session ? disconnect : connect} style={[styles.button, busy && styles.busy]}>
            {busy ? <ActivityIndicator color={colors.background} /> : <>
              {!session && <GoogleLogoIcon size={20} color={colors.background} />}
              <Text style={styles.buttonText}>{session ? 'Sign out' : 'Continue with Google'}</Text>
            </>}
          </Pressable>
        )}
        {session && <Pressable accessibilityRole="button" disabled={busy} onPress={connect} style={styles.back}>
          <Text style={styles.backText}>Reconnect calendar access</Text>
        </Pressable>}
        {(message || initializationError) && <Text accessibilityRole="alert" style={styles.message}>{message ?? initializationError}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 26 },
  back: { minHeight: 44, justifyContent: 'center' },
  backText: { fontFamily: fonts.regular, color: colors.inactive, fontSize: 14, lineHeight: 20 },
  body: { flex: 1, justifyContent: 'center', gap: 20 },
  title: { fontFamily: fonts.heading, color: colors.heading, fontSize: 28, lineHeight: 31 },
  description: { fontFamily: fonts.regular, color: colors.foreground, fontSize: 14, lineHeight: 21 },
  button: { minHeight: 52, borderRadius: 26, backgroundColor: colors.foreground, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  buttonText: { fontFamily: fonts.medium, color: colors.background, fontSize: 14, lineHeight: 20 },
  busy: { opacity: 0.65 },
  message: { fontFamily: fonts.regular, color: colors.inactive, fontSize: 13, lineHeight: 20 },
});
