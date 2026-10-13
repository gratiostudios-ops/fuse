/** Web has no closed-app scheduler; RefreshLifecycle provides visible-tab polling. */
export async function registerBackgroundRefresh(): Promise<'registered' | 'unavailable'> {
  return 'unavailable';
}
