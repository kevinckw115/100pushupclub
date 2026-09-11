import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Network from 'expo-network';
import { useLocal } from './local-context';
import { useAuth } from './auth-context';
import { authEnvironment } from './auth-client';
import { HttpSyncTransport } from '../data/sync/transport';
import { CheckedReader } from '../data/checked-reader';
import type { CheckedState } from '../data/checked-reader';
import { SafetyRepository } from '../data/local/safety';
const empty: CheckedState<never> = { value: null, status: 'waiting' };
const emptySnapshot = () => empty, emptySubscribe = () => () => {};
export function useCircleReader<T>(read: (transport: HttpSyncTransport, signal: AbortSignal) => Promise<T>, enabled = true) {
  const { repo, partition } = useLocal(), { connection } = useAuth(), id = partition?.kind === 'account' ? partition.id : null;
  const pending = !!id && !!repo && (!!repo.preference(id, 'pending_circle') || new SafetyRepository(repo, id).all().some(p => p.request.operation !== 'report_subject'));
  const version = id ? `${repo?.preference(id, 'circle_receipt')}:${repo?.preference(id, 'safety_receipt')}:${repo?.preference(id, 'account_profile')}` : '';
  const reader = useMemo(() => {
    if (!id || !repo || !connection || !authEnvironment.connected) return null;
    const transport = new HttpSyncTransport(authEnvironment.url!, authEnvironment.key!, connection);
    return new CheckedReader(signal => read(transport, signal), () => connection.valid() && repo.activePartition()?.id === id);
  }, [id, repo, connection, read]);
  const state = useSyncExternalStore(reader?.subscribe ?? emptySubscribe, reader?.snapshot ?? emptySnapshot, emptySnapshot);
  useEffect(() => { reader?.invalidate(); }, [reader, version]);
  useEffect(() => () => reader?.stop(), [reader]);
  useFocusEffect(useCallback(() => {
    if (!reader || !enabled || pending) return;
    reader.setActive(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', state => reader.setActive(state === 'active'));
    const network = Network.addNetworkStateListener(state => reader.setOnline(state.isConnected !== false && state.isInternetReachable !== false));
    let active = true; void Network.getNetworkStateAsync().then(state => { if (active) reader.setOnline(state.isConnected !== false && state.isInternetReachable !== false); }, () => {});
    return () => { active = false; app.remove(); network.remove(); reader.setActive(false); };
  }, [reader, pending, enabled]));
  return { state: pending || !enabled ? empty as CheckedState<T> : state, refresh: () => { void reader?.refresh(); }, connected: !!reader, pending };
}
