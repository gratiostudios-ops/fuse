import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { registerBackgroundRefresh } from '../background/task';
import { REFRESH_INTERVAL_MS } from '../refresh/engine';
import { initializeRefreshRuntime } from '../refresh/runtime';

export function RefreshLifecycle() {
  useEffect(() => {
    try {
      const runtime = initializeRefreshRuntime();
      const run = () => { void runtime.run(); };
      run();
      void registerBackgroundRefresh().catch(error => {
        console.warn('Background refresh registration failed:', error instanceof Error ? error.message : 'unknown error');
      });
      const appState = AppState.addEventListener('change', state => { if (state === 'active') run(); });
      const visible = () => { if (document.visibilityState === 'visible') run(); };
      if (Platform.OS === 'web') document.addEventListener('visibilitychange', visible);
      const timer = setInterval(() => {
        if (Platform.OS === 'web' ? document.visibilityState === 'visible' : AppState.currentState === 'active') run();
      }, REFRESH_INTERVAL_MS);
      return () => {
        appState.remove();
        clearInterval(timer);
        if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visible);
      };
    } catch (error) {
      console.warn('Refresh initialization failed:', error instanceof Error ? error.message : 'unknown error');
    }
  }, []);
  return null;
}
