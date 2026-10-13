export class GoogleProviderDisabledError extends Error {
  readonly code = 'GOOGLE_PROVIDER_DISABLED';
  constructor() {
    super('Google sign-in is currently unavailable.');
    this.name = 'GoogleProviderDisabledError';
  }
}

/** Check public provider settings before sending the user out of the app. */
export async function assertGoogleProviderEnabled(
  config: { url: string; publishableKey: string },
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(`${config.url}/auth/v1/settings`, {
    headers: { apikey: config.publishableKey },
  });
  if (!response.ok) throw new Error('Could not check Google sign-in availability. Please try again.');
  const settings = await response.json() as { external?: { google?: boolean } };
  if (settings.external?.google !== true) throw new GoogleProviderDisabledError();
}
