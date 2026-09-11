import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Network from 'expo-network';
import { AppScreen, Header, Copy, Notice, Button, Section } from '../../src/components/ui';
import { useLocal } from '../../src/services/local-context';
import { useAuth } from '../../src/services/auth-context';
import { authEnvironment } from '../../src/services/auth-client';
import { HttpClubTransport } from '../../src/data/club';
import { ClubReader } from '../../src/data/club-reader';
import type { ClubState } from '../../src/data/club-reader';
import { region, world } from '../../src/data/regions';
import { theme } from '../../src/theme/theme';

const empty: ClubState = { scope: 'world', page: null, rows: [], updates: null, status: 'waiting', fetchedAt: null, observedAt: 0 };
const emptySnapshot = () => empty, emptySubscribe = () => () => {};
export default function Club() {
  const router = useRouter(), { repo, partition, refresh } = useLocal(), { connection } = useAuth();
  const identity = partition?.id, account = partition?.kind === 'account';
  const reader = useMemo(() => {
    if (!repo || !identity || !authEnvironment.connected || (account && !connection)) return null;
    const valid = () => repo.activePartition()?.id === identity && (!account || !!connection?.valid());
    return new ClubReader(new HttpClubTransport(authEnvironment.url!, authEnvironment.key!, account ? connection : null, valid), valid);
  }, [repo, identity, account, connection]);
  const state = useSyncExternalStore(reader?.subscribe ?? emptySubscribe, reader?.snapshot ?? emptySnapshot, emptySnapshot);
  let browsing = world;
  try { const saved = repo?.preference(identity ?? 'device', 'browse_region'); if (saved) browsing = region(JSON.parse(saved)); } catch { /* Invalid local selection falls back to World. */ }
  const selected = repo?.preference(identity ?? 'device', 'club_scope') === 'world' ? 'world' : browsing.id;
  useEffect(() => { reader?.setScope(selected); }, [reader, selected]);
  useEffect(() => () => reader?.stop(), [reader]);
  useFocusEffect(useCallback(() => {
    if (!reader) return;
    reader.setActive(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', value => reader.setActive(value === 'active'));
    let active = true;
    const network = Network.addNetworkStateListener(value => reader.setOnline(value.isConnected !== false && value.isInternetReachable !== false));
    void Network.getNetworkStateAsync().then(value => { if (active) reader.setOnline(value.isConnected !== false && value.isInternetReachable !== false); }, () => {});
    return () => { active = false; app.remove(); network.remove(); reader.setActive(false); };
  }, [reader]));
  const choose = (value: 'world' | 'region') => { if (!repo || !identity) return; repo.setPreference(identity, 'club_scope', value); reader?.setScope(value === 'world' ? 'world' : browsing.id); refresh(); };
  const page = state.scope === selected ? state.page : null;
  const age = state.fetchedAt === null ? null : Math.max(0, Math.floor((state.observedAt - state.fetchedAt) / 60000));
  return <AppScreen><Header onSettings={() => router.push('/settings')} /><Copy variant="title">Club</Copy>
    <Copy>A little effort, together.</Copy>
    <View style={{ flexDirection: 'row', gap: theme.spacing[1] }}>
      <View style={{ flex: 1 }}><Button label="World" secondary={selected !== 'world'} onPress={() => choose('world')} /></View>
      <View style={{ flex: 1 }}><Button label="My region" secondary={selected === 'world'} onPress={() => browsing.id === 'world' ? router.push('/region') : choose('region')} /></View>
    </View>
    <Copy variant="caption">Browsing region: {browsing.label}. Chosen manually.</Copy>
    <Button secondary label="Change browsing region" onPress={() => router.push('/region')} />
    {!authEnvironment.connected ? <Notice>Community is not connected yet. Your personal check-ins still work offline.</Notice> : !reader ? <><Notice>Sign in to reconnect your account before browsing.</Notice><Button label="Reconnect account" onPress={() => router.push('/auth')} /></> : <>
      {page && <>
        <Copy variant="section">{page.effective_scope.label}</Copy>
        {page.fallback_reason && <Notice>{page.fallback_reason === 'SPARSE_REGION' ? `Showing ${page.effective_scope.label} while your area gets started.` : `Your saved area is unavailable. Showing ${page.effective_scope.label}.`}</Notice>}
        <Section title="Pushups in the past 24 hours"><Copy variant="headline" accessibilityLabel={`${page.pushups_past_24_hours} pushups in the past 24 hours`}>{page.pushups_past_24_hours.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</Copy><Copy>{page.people_past_hour} {page.people_past_hour === 1 ? 'person' : 'people'} checked in during the past hour.</Copy></Section>
      </>}
      <Section title="Recent check-ins">
        <Copy variant="caption">{age === null ? 'Waiting for the first update.' : age === 0 ? 'Updated just now.' : `Updated ${age} min ago.`} Refreshes while this screen is open.</Copy>
        {state.status === 'loading' && <Copy>Checking for recent activity…</Copy>}
        {state.status === 'offline' && <Notice>Offline. Public activity is hidden until we can refresh it. Your personal log still works.</Notice>}
        {state.status === 'error' && <Notice error>{state.code === 'RATE_LIMITED' ? 'Please wait a moment. We will retry after the server’s pause.' : state.code === 'UNAUTHENTICATED' || state.code === 'ACCOUNT_UNAVAILABLE' ? 'Account access needs attention. Reconnect from Settings.' : state.code === 'INVALID_CURSOR' ? 'This page changed. Refreshing the latest activity.' : 'Could not refresh the Club. Public activity is hidden until it can be checked again.'}</Notice>}
        <Button secondary label={state.updates ? 'Show updated check-ins' : 'No new check-ins to show'} disabled={!state.updates} onPress={() => reader.showUpdates()} />
        {page && !page.items.length && <Copy>No check-ins yet. Start with yours when you’re ready.</Copy>}
        {page && state.rows.map(row => <View key={row.id} style={{ borderBottomWidth: 1, borderColor: theme.colors.divider, paddingVertical: theme.spacing[2], gap: theme.spacing[0] }}>
          <Copy variant="section">{row.username}</Copy><Copy>{row.quantity} pushups <Copy variant="caption">· {row.relative_time}</Copy></Copy>
        </View>)}
        {page?.next_cursor && !state.updates && state.rows.length < 100 && <Button secondary label="Load older check-ins" onPress={() => { void reader.more(); }} disabled={state.status === 'loading'} />}
        {state.rows.length >= 100 && <Copy>Showing 100 recent check-ins. Refresh to return to the latest.</Copy>}
        <Button secondary label="Refresh Club" onPress={() => { void reader.refresh(); }} disabled={state.status === 'loading'} />
      </Section>
    </>}
    <Section title="Your choice"><Copy>Browsing is welcome. Public sharing is optional, and guest history stays private.</Copy><Button secondary label={account ? 'Manage public sharing' : 'Sign in to contribute'} onPress={() => router.push(account ? '/sharing' : '/auth')} /></Section>
  </AppScreen>;
}
