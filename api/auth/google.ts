import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '../supabase';
import { validateSupabaseConfig } from '../config';
import { assertGoogleProviderEnabled } from './provider';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
let exchange: { code: string; result: Promise<Session> } | undefined;

export function getGoogleRedirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'fuse', path: 'auth/callback', native: 'fuse://auth/callback' });
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
  const result = getSupabaseClient().auth.exchangeCodeForSession(code).then(({ data, error }) => {
    if (error) throw error;
    if (!data.session) throw new Error('Google sign-in did not establish a session.');
    return data.session;
  });
  exchange = { code, result };
  return result;
}

export function clearGoogleSignInExchange(): void {
  exchange = undefined;
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
      scopes: `openid email profile ${GOOGLE_CALENDAR_SCOPE}`,
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account consent' },
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
