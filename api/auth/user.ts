import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { CatalogDatabase } from '../types';

export class AuthenticationRequiredError extends Error {
  readonly code = 'AUTHENTICATION_REQUIRED';
  constructor() {
    super('Sign in with Google to access your tasks.');
    this.name = 'AuthenticationRequiredError';
  }
}

export async function readCurrentUser(client: SupabaseClient<CatalogDatabase>): Promise<User | null> {
  // Verify the user with Supabase Auth; a caller-supplied user ID is never trusted.
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403) return null;
    throw error;
  }
  return data.user;
}

export async function requireCurrentUser(client: SupabaseClient<CatalogDatabase>): Promise<User> {
  const user = await readCurrentUser(client);
  if (!user) throw new AuthenticationRequiredError();
  return user;
}
