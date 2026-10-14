import './platform';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CatalogDatabase } from './types';
import { authStorage, canPersistSession } from './storage';

//supabase config
type ConfigInput = { url: string | undefined; publishableKey: string | undefined };

const diagnosticFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (error) {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let host = 'unknown host';
    try { host = new URL(requestUrl).host; } catch { /* Keep the log free of request headers and query values. */ }
    console.error(`Supabase HTTPS request failed for ${host}:`, error);
    throw error;
  }
};

export function validateSupabaseConfig({ url, publishableKey }: ConfigInput) {
  if (!url?.trim() || !publishableKey?.trim()) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart Expo.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS project URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS project URL.');
  }

  const key = publishableKey.trim();
  if (!key.startsWith('sb_publishable_')) {
    throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key (sb_publishable_...).');
  }

  return { url: url.trim().replace(/\/+$/, ''), publishableKey: key };
}

let client: SupabaseClient<CatalogDatabase> | undefined;

/** Lazy initialization keeps the UI usable before project configuration is supplied. */
export function getSupabaseClient(): SupabaseClient<CatalogDatabase> {
  if (!client) {
    const config = validateSupabaseConfig({
      // Expo requires literal property access to inline public environment variables.
      url: process.env.EXPO_PUBLIC_SUPABASE_URL,
      publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    client = createClient<CatalogDatabase>(config.url, config.publishableKey, {
      global: { fetch: diagnosticFetch },
      auth: {
        storage: authStorage,
        persistSession: canPersistSession,
        autoRefreshToken: canPersistSession,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }
  return client;
}
