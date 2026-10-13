type ConfigInput = { url: string | undefined; publishableKey: string | undefined };

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
