/** Native navigation starts implicit OAuth independently of session recovery. */
export function googleSignInUrl(supabaseUrl: string, returnOrigin: string): string {
  const url = new URL('/auth/v1/authorize', supabaseUrl);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', new URL(returnOrigin).origin);
  return url.toString();
}

export function oauthCallbackError(search: string, hash: string): string {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const error = query.get('error_description') || fragment.get('error_description') || query.get('error') || fragment.get('error');
  return error ? `Google sign-in failed: ${error.slice(0, 400)}` : '';
}
