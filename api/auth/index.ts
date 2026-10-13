import { getSupabaseClient } from '../supabase';
import { clearGoogleSignInExchange } from './google';
import { readCurrentUser } from './user';

export { signInWithGoogle } from './google';
export { AuthenticationRequiredError } from './user';

export function getCurrentUser() {
  return readCurrentUser(getSupabaseClient());
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
  if (error) throw error;
  clearGoogleSignInExchange();
}
