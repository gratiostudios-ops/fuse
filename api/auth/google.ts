import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, validateSupabaseConfig } from '../supabase';
import { assertGoogleProviderEnabled } from './provider';
import { registerGoogleCredentials } from '../organizer';

let exchange: { code: string; result: Promise<Session> } | undefined;
let successNavigationClaimed = false;

export function getGoogleRedirectUri(): string {
  // Standalone Android/iOS apps must return through the registered app link,
  // never Expo's development server URL.
  if (Platform.OS !== 'web') return 'fuse://auth/callback';
  return AuthSession.makeRedirectUri({ path: 'auth/callback' });
}

export function completeGoogleSignIn(callbackUrl: string): Promise<Session> {
  const callback = new URL(callbackUrl);
  const expected = new URL(getGoogleRedirectUri());
  if (callback.protocol !== expected.protocol || callback.host !== expected.host || callback.pathname !== expected.pathname) {
    return Promise.reject(new Error('Unexpected Google sign-in callback URL.'));
  }
  const oauthError = callback.searchParams.get('error_description') ?? callback.searchParams.get('error');
  if (oauthError) return Promise.reject(new Error(oauthError));
  const code = callback.searchParams.get('code');
  if (!code) return Promise.reject(new Error('Google sign-in returned no authorization code.'));
  // Browser completion and the deep-link route can receive the same code together.
  if (exchange?.code === code) return exchange.result;
  const result = getSupabaseClient().auth.exchangeCodeForSession(code).then(async ({ data, error }) => {
    if (error) throw error;
    if (!data.session) throw new Error('Google sign-in did not establish a session.');
    try { await registerGoogleCredentials(data.session); }
    catch (error) { throw new Error(`Calendar connection incomplete. ${error instanceof Error ? error.message : 'Retry connecting Google Calendar.'}`); }
    return data.session;
  });
  exchange = { code, result };
  return result;
}

export function clearGoogleSignInExchange(): void {
  exchange = undefined;
  successNavigationClaimed = false;
}

/** The callback route and the browser result can both finish the same sign-in. */
export function claimGoogleSignInNavigation(): boolean {
  if (successNavigationClaimed) return false;
  successNavigationClaimed = true;
  return true;
}

export async function signInWithGoogle(): Promise<{ status: 'signed-in' | 'cancelled' | 'redirecting' }> {
  await assertGoogleProviderEnabled(validateSupabaseConfig({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }));
  const redirectTo = getGoogleRedirectUri();
  const { data, error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      scopes: 'openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks',
      skipBrowserRedirect: true,
      queryParams: { access_type: 'offline', prompt: 'select_account consent' },
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google sign-in is not configured in Supabase.');
  if (Platform.OS === 'web') {
    window.location.assign(data.url);
    return { status: 'redirecting' };
  }
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') return { status: 'cancelled' };
  if (result.type !== 'success') throw new Error('Could not complete Google sign-in.');
  await completeGoogleSignIn(result.url);
  return { status: 'signed-in' };
}
