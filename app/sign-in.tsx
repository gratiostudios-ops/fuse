import { useState, useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoogleLogoIcon } from 'phosphor-react-native';
import { signInWithGoogle, signOut } from '../api/auth';
import { useAuth } from '../src/auth-context';
import { connectOrganizer, disconnectOrganizer, retryGoogleRegistration, saveOrganizerTimezone } from '../api/organizer';
import { useOrganizer } from '../src/organizer';
import { colors, fonts } from '../src/theme';

export default function SignInScreen() {
  const { session, loading, error: initializationError } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const organizer = useOrganizer(session?.user.id ?? null);
  const [timezone, setTimezone] = useState('');
  useEffect(() => { if (organizer.state) setTimezone(organizer.state.timezone); }, [organizer.state?.timezone]);
  async function integration(action: () => Promise<unknown>) {
    setBusy(true); setMessage(null);
    try { await action(); await organizer.reload(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not update Google connection.'); }
    finally { setBusy(false); }
  }

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
    <ScrollView contentContainerStyle={[styles.screen, { paddingTop: Math.max(58, insets.top + 16), paddingBottom: insets.bottom + 24 }]}>
      <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>Your Google account</Text>
        <Text style={styles.description}>
          {session ? `Signed in as ${session.user.email ?? 'your Google account'}.` : 'Connect Google Calendar to sign in and authorize Calendar and Tasks together.'}
        </Text>
        {loading ? <ActivityIndicator color={colors.foreground} /> : (
          <Pressable accessibilityRole="button" disabled={busy} onPress={session ? disconnect : connect} style={[styles.button, busy && styles.busy]}>
            {busy ? <ActivityIndicator color={colors.background} /> : <>
              {!session && <GoogleLogoIcon size={20} color={colors.background} />}
              <Text style={styles.buttonText}>{session ? 'Sign out' : 'Connect Google Calendar'}</Text>
            </>}
          </Pressable>
        )}
        {session && <>
          <Text style={styles.description}>{organizer.loading ? 'Checking Google connection…' : !organizer.state ? 'Google connection status could not be loaded.' : organizer.state.connection?.connection_status === 'connected' ? `Calendar connected: ${organizer.state.connection.google_acc}` : organizer.state.connection?.connection_status === 'reconnect_required' ? 'Calendar connection incomplete. Reconnect Google Calendar.' : 'Google Calendar and Tasks are not connected.'}</Text>
          {!!organizer.state?.connection?.last_error && <Text accessibilityRole="alert" style={styles.message}>{organizer.state.connection.last_error}</Text>}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void integration(async () => { const result = await connectOrganizer(); if (result.status === 'cancelled') setMessage('Connection cancelled. You can try again.'); }); }} style={styles.back}>
            <Text style={styles.backText}>Connect Google Calendar</Text>
          </Pressable>
          {organizer.state?.connection?.connection_status !== 'connected' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void integration(retryGoogleRegistration); }} style={styles.back}>
            <Text style={styles.backText}>Retry Calendar connection</Text>
          </Pressable>}
          {organizer.state?.connection?.connection_status !== 'disconnected' && organizer.state?.connection && <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void integration(disconnectOrganizer); }} style={styles.back}>
            <Text style={styles.backText}>Disconnect Google Calendar</Text>
          </Pressable>}
          <Text style={styles.description}>Daily recap time zone (9 PM)</Text>
          <TextInput accessibilityLabel="Daily recap time zone" style={styles.timezone} value={timezone} onChangeText={setTimezone} autoCapitalize="none" placeholder="Asia/Kolkata" placeholderTextColor={colors.placeholder} />
          <Pressable accessibilityRole="button" disabled={busy || !timezone.trim()} onPress={() => { void integration(() => saveOrganizerTimezone(timezone.trim())); }} style={styles.back}><Text style={styles.backText}>Save time zone</Text></Pressable>
          {!!organizer.error && <Text accessibilityRole="alert" style={styles.message}>{organizer.error}</Text>}
        </>}
        {(message || initializationError) && <Text accessibilityRole="alert" style={styles.message}>{message ?? initializationError}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, backgroundColor: colors.background, paddingHorizontal: 26 },
  timezone: { color: colors.foreground, fontFamily: fonts.regular, padding: 12, backgroundColor: colors.composer, borderRadius: 12 },
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
