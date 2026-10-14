import { getSupabaseClient } from '../supabase';
import { clearGoogleSignInExchange } from './google';
import { readCurrentUser } from './user';
import { clearOrganizerCache, notifyOrganizerChanged } from '../organizer';
import { clearRefreshCache } from '../../refresh/cache';

export { signInWithGoogle } from './google';
export { AuthenticationRequiredError } from './user';

export function getCurrentUser() {
  return readCurrentUser(getSupabaseClient());
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
  if (error) throw error;
  clearGoogleSignInExchange();
  clearOrganizerCache(); notifyOrganizerChanged('signout');
  await clearRefreshCache();
}
