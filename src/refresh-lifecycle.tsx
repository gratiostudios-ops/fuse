import { getSupabaseClient } from '../api/supabase';
import { retrySuggestionReceipts } from '../api/user-suggestions';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { registerBackgroundRefresh } from '../background/task';
import { REFRESH_INTERVAL_MS } from '../refresh/engine';
import { initializeRefreshRuntime } from '../refresh/runtime';

export function RefreshLifecycle() {
  useEffect(() => {
    try {
      const runtime = initializeRefreshRuntime();
      let alive = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const active = () => Platform.OS === 'web' ? document.visibilityState === 'visible' : AppState.currentState === 'active';
      const run = () => {
        if (timer) clearTimeout(timer);
        if (!alive || !active()) return;
        void runtime.run().then(result => {
          if (!alive || !active()) return;
          const timestamp = result.record?.attemptedAt ?? result.record?.completedAt;
          const elapsed = timestamp ? Date.now() - Date.parse(timestamp) : 0;
          const delay = Number.isFinite(elapsed) && elapsed >= 0 ? Math.max(1000, REFRESH_INTERVAL_MS - elapsed) : REFRESH_INTERVAL_MS;
          if (timer) clearTimeout(timer);
          timer = setTimeout(run, delay);
        }).catch(() => {
          if (alive && active()) timer = setTimeout(run, REFRESH_INTERVAL_MS);
        });
        void getSupabaseClient().auth.getSession().then(({ data }) => { if (data.session) void retrySuggestionReceipts(data.session.user.id); }).catch(() => {});
      };
      run();
      void registerBackgroundRefresh().catch(error => {
        console.warn('Background refresh registration failed:', error instanceof Error ? error.message : 'unknown error');
      });
      const visibilityChanged = () => { if (active()) run(); else if (timer) clearTimeout(timer); };
      const appState = AppState.addEventListener('change', visibilityChanged);
      const visible = visibilityChanged;
      if (Platform.OS === 'web') document.addEventListener('visibilitychange', visible);
      return () => {
        alive = false;
        appState.remove();
        if (timer) clearTimeout(timer);
        if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visible);
      };
    } catch (error) {
      console.warn('Refresh initialization failed:', error instanceof Error ? error.message : 'unknown error');
    }
  }, []);
  return null;
}
