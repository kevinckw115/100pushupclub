import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { useLocal } from './local-context';
import { useAuth } from './auth-context';
import { authEnvironment } from './auth-client';
import { SyncRepository } from '../data/sync/repository';
import { HttpSyncTransport } from '../data/sync/transport';
import { SyncEngine } from '../data/sync/engine';
import type { SyncStatus } from '../data/sync/engine';

const Context = createContext<{ repository: SyncRepository | null; status: SyncStatus; retry: () => void } | null>(null);
export function SyncProvider({ children }: PropsWithChildren) {
  const { repo, partition, revision, refresh } = useLocal();
  const { connection } = useAuth();
  const accountId = partition?.kind === 'account' ? partition.id : null;
  const repository = useMemo(() => repo && accountId ? new SyncRepository(repo, accountId) : null, [repo, accountId]);
  const engine = useRef<SyncEngine | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ state: 'waiting' });
  useEffect(() => {
    if (!repository || !connection || connection.userId !== accountId || !authEnvironment.connected) return;
    const current = new SyncEngine({ repo: repository, transport: new HttpSyncTransport(authEnvironment.url!, authEnvironment.key!, connection), valid: connection.valid, changed: refresh, report: setStatus });
    engine.current = current;
    if (AppState.currentState !== 'active') current.setForeground(false);
    const kickoff = setTimeout(() => void current.sync(), 0);
    const appState = AppState.addEventListener('change', state => current.setForeground(state === 'active'));
    const network = Network.addNetworkStateListener(state => current.setOnline(state.isConnected !== false && state.isInternetReachable !== false));
    void Network.getNetworkStateAsync().then(state => current.setOnline(state.isConnected !== false && state.isInternetReachable !== false), () => {});
    const poll = setInterval(() => void current.sync(), 30000);
    return () => { current.stop(); engine.current = null; clearTimeout(kickoff); clearInterval(poll); appState.remove(); network.remove(); };
  }, [repository, connection, accountId, refresh]);
  useEffect(() => { void engine.current?.sync(); }, [revision]);
  return <Context.Provider value={{ repository, status, retry: () => { void engine.current?.retry(); } }}>{children}</Context.Provider>;
}
export function useSync() { const value = useContext(Context); if (!value) throw new Error('Sync provider is missing.'); return value; }
