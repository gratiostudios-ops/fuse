import './platform';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateSupabaseConfig } from './config';
import type { CatalogDatabase } from './types';
import { authStorage, canPersistSession, sessionLock } from './storage';

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
      auth: {
        storage: authStorage,
        persistSession: canPersistSession,
        autoRefreshToken: canPersistSession,
        detectSessionInUrl: false,
        flowType: 'pkce',
        ...(sessionLock ? { lock: sessionLock } : {}),
      },
    });
  }
  return client;
}
