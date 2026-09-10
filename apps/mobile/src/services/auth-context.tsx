import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';
import { makeAuthClient, sessionStore, authEnvironment } from './auth-client';
import { useLocal, LoadingStorage } from './local-context';
import { Generation } from '../domain/generation';
import { AppScreen, Header, Notice, Button } from '../components/ui';

type Status = 'guest' | 'ready' | 'recovery' | 'offline';
type AuthState = { status: Status; connected: boolean; web: boolean; message: string | null; send: (email: string) => Promise<void>; verify: (email: string, code: string) => Promise<boolean>; cancel: () => Promise<void>; recover: () => Promise<void>; signOut: (discard: boolean) => Promise<void> };
const Context = createContext<AuthState | null>(null);
const safeError = (error: { code?: string; status?: number } | null) => error?.status === 429 ? 'Too many attempts. Wait a minute and try again.' : error?.code === 'otp_expired' ? 'That code is incorrect or expired. Request another code.' : 'Could not sign in. Check your connection and try again.';

export function AuthProvider({ children }: PropsWithChildren) {
  const { repo, refresh } = useLocal();
  const [ready, setReady] = useState(false), [fatal, setFatal] = useState(false);
  const [status, setStatus] = useState<Status>('guest');
  const [message, setMessage] = useState<string | null>(null);
  const [restart, setRestart] = useState(0);
  const runtime = useRef<ReturnType<typeof makeAuthClient>>(null);
  const lastSession = useRef<Session | null>(null);
  const [generation] = useState(() => new Generation());
  const accept = useCallback(async (session: Session | null, ticket: number) => {
    const current = runtime.current;
    if (!current || !repo || !generation.current(ticket)) return false;
    if (!session) { setStatus(repo.activePartition()?.kind === 'account' ? 'recovery' : 'guest'); return false; }
    const { data, error } = await current.client.auth.getUser();
    if (!generation.current(ticket)) return false;
    if (error || !data.user?.email_confirmed_at || data.user.is_anonymous) {
      setStatus('offline'); setMessage('Sign-in could not be verified. Your local check-ins are safe.'); return false;
    }
    const userId = data.user.id;
    const active = repo.activePartition();
    if (active?.kind === 'account' && active.id !== userId) {
      setStatus('recovery'); setMessage('Sign out of the current account before changing accounts.'); return false;
    }
    let operation = repo.preference(userId, 'bootstrap_operation');
    if (!operation) { operation = randomUUID(); repo.setPreference(userId, 'bootstrap_operation', operation); }
    const bootstrap = await current.client.rpc('bootstrap_profile', { operation_id: operation });
    if (!generation.current(ticket)) return false;
    if (bootstrap.error || !bootstrap.data?.profile) {
      setStatus('recovery'); setMessage('Account access could not be confirmed. Retry when connected.'); return false;
    }
    repo.activateAccount(userId, new Date().toISOString());
    refresh(); setStatus('ready'); setMessage(null); return true;
  }, [repo, generation, refresh]);

  useEffect(() => {
    if (!repo) return;
    let live = true;
    const ticket = generation.next();
    let subscription: { unsubscribe(): void } | undefined;
    const initialize = async () => {
      try {
        // SQLite is the installation marker; iOS Keychain can survive uninstall.
        if (!repo.preference('device', 'installation')) {
          await sessionStore.clear();
          repo.setPreference('device', 'installation', randomUUID());
        }
        const logout = repo.preference('device', 'pending_logout');
        if (logout) {
          await sessionStore.clear();
          const value = JSON.parse(logout);
          if (repo.activePartition()?.id === value.id) repo.signOutAccount(value.id, new Date().toISOString(), value.discard);
          repo.setPreference('device', 'pending_logout', ''); refresh();
        }
        if (!live) return;
        runtime.current = makeAuthClient();
        setStatus(repo.activePartition()?.kind === 'account' ? 'offline' : 'guest');
        setReady(true);
        if (runtime.current) {
          const client = runtime.current.client;
          subscription = client.auth.onAuthStateChange((event, session) => {
            if (!live || runtime.current?.client !== client) return;
            lastSession.current = session;
            if (event === 'SIGNED_OUT') { generation.next(); setStatus(repo.activePartition()?.kind === 'account' ? 'recovery' : 'guest'); }
          }).data.subscription;
          const { data, error } = await client.auth.getSession();
          if (error) { setStatus('recovery'); setMessage('Reconnect your account when online. Local check-ins are safe.'); return; }
          if (live) lastSession.current = data.session;
          await accept(data.session, ticket);
          if (live && AppState.currentState === 'active') void client.auth.startAutoRefresh();
        }
        if (live) setReady(true);
      } catch { if (live) { setFatal(true); setMessage('Secure sign-in storage could not be opened. Your check-ins have not been deleted.'); } }
    };
    void initialize();
    const appState = AppState.addEventListener('change', state => {
      const client = runtime.current?.client;
      if (state === 'active') void client?.auth.startAutoRefresh();
      else void client?.auth.stopAutoRefresh();
    });
    return () => { live = false; generation.next(); subscription?.unsubscribe(); runtime.current?.dispose(); runtime.current = null; appState.remove(); };
  }, [repo, restart, generation, accept, refresh]);

  const send = async (email: string) => {
    const current = runtime.current;
    if (!current) throw new Error('Account sign-in is not connected yet.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
    const { error } = await current.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw new Error(safeError(error));
  };
  const verify = async (email: string, token: string) => {
    const current = runtime.current;
    if (!current) throw new Error('Account sign-in is not connected yet.');
    if (!/^\d{6,10}$/.test(token)) throw new Error('Enter the code from your email.');
    const ticket = generation.next();
    const { data, error } = await current.client.auth.verifyOtp({ email, token, type: 'email' });
    if (!generation.current(ticket)) return false;
    if (error) throw new Error(safeError(error));
    return accept(data.session, ticket);
  };
  const recover = async () => {
    const ticket = generation.next(); const client = runtime.current?.client;
    if (client) { const { data } = await client.auth.getSession(); await accept(data.session, ticket); }
  };
  const cancel = async () => {
    generation.next(); runtime.current?.dispose(); runtime.current = null;
    // Cancelling guest sign-in must invalidate any late verification persistence.
    if (repo?.activePartition()?.kind !== 'account') await sessionStore.clear();
    setReady(false); setMessage(null); setRestart(value => value + 1);
  };
  const signOut = async (discard: boolean) => {
    if (!repo) return;
    const account = repo.activePartition();
    if (account?.kind !== 'account') return;
    if (!discard && repo.unsynced(account.id)) throw new Error('Unsynced check-ins need your decision.');
    repo.setPreference('device', 'pending_logout', JSON.stringify({ id: account.id, discard }));
    generation.next();
    const current = runtime.current;
    runtime.current = null; current?.dispose();
    // Remote revocation is best-effort; local logout also works without a network.
    const token = lastSession.current?.access_token;
    lastSession.current = null;
    if (token && authEnvironment.connected) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
      void fetch(authEnvironment.url + '/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: authEnvironment.key!, Authorization: 'Bearer ' + token }, signal: controller.signal }).catch(() => {}).finally(() => clearTimeout(timer));
    }
    await sessionStore.clear();
    repo.signOutAccount(account.id, new Date().toISOString(), discard);
    repo.setPreference('device', 'pending_logout', '');
    refresh(); setStatus('guest'); setMessage(null); setReady(false); setRestart(value => value + 1);
  };
  if (fatal) return <AppScreen><Header /><Notice error>{message}</Notice><Button label="Retry opening sign-in storage" onPress={() => { setFatal(false); setRestart(value => value + 1); }} /><Notice>Resetting sign-in storage requires signing in again. It keeps your local check-ins.</Notice><Button secondary label="Reset sign-in storage" onPress={() => {
    generation.next(); runtime.current?.dispose(); runtime.current = null;
    void sessionStore.clear().then(() => { setFatal(false); setReady(false); setRestart(value => value + 1); }).catch(() => setMessage('Secure storage is still unavailable. Please restart the app.'));
  }} /></AppScreen>;
  if (!ready) return <LoadingStorage />;
  return <Context.Provider value={{ status, message, connected: authEnvironment.connected, web: Platform.OS === 'web', send, verify, cancel, recover, signOut }}>{children}</Context.Provider>;
}

export function useAuth() { const value = useContext(Context); if (!value) throw new Error('Auth provider is missing.'); return value; }
