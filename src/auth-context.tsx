import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '../api/supabase';

type AuthState = { session: Session | null; loading: boolean; error: string | null };
const AuthContext = createContext<AuthState>({ session: null, loading: true, error: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true, error: null });

  useEffect(() => {
    let alive = true;
    try {
      const client = getSupabaseClient();
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
        if (alive) setState({ session, loading: false, error: null });
      });
      void client.auth.getSession().then(({ data, error }) => {
        if (alive) setState({ session: data.session, loading: false, error: error?.message ?? null });
      }).catch(error => {
        if (alive) setState({ session: null, loading: false, error: error instanceof Error ? error.message : 'Could not restore sign-in.' });
      });

      // The browser SDK handles visibility itself. Mobile refresh follows AppState.
      const appState = Platform.OS !== 'web'
        ? AppState.addEventListener('change', next => {
          if (next === 'active') client.auth.startAutoRefresh();
          else client.auth.stopAutoRefresh();
        })
        : undefined;
      if (Platform.OS !== 'web' && AppState.currentState === 'active') client.auth.startAutoRefresh();
      return () => {
        alive = false;
        subscription.unsubscribe();
        appState?.remove();
        if (Platform.OS !== 'web') client.auth.stopAutoRefresh();
      };
    } catch (error) {
      setState({ session: null, loading: false, error: error instanceof Error ? error.message : 'Could not initialize sign-in.' });
    }
    return () => { alive = false; };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
