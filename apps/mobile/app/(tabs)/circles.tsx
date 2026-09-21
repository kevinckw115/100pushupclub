import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Notice, Button, Row } from '../../src/components/ui';
import { CircleGate, CircleNotice, CircleReadStatus } from '../../src/components/circle-common';
import { useCircleReader } from '../../src/services/circle-reader';
import type { HttpSyncTransport } from '../../src/data/sync/transport';
import { useLocal } from '../../src/services/local-context';
const read = (t: HttpSyncTransport, signal: AbortSignal) => t.circles(signal);
export default function Circles() {
  const router = useRouter(), view = useCircleReader(read), items = view.state.value?.items, { repo, refresh } = useLocal();
  const incoming = repo?.preference('device', 'incoming_circle_invite');
  return <AppScreen><Header onSettings={() => router.push('/settings')} /><Copy variant="title">Circles</Copy><Copy>A small group, showing up together.</Copy><CircleGate /><CircleNotice />
    {view.connected && <><CircleReadStatus state={view.state} />
      {incoming && <><Notice>An incoming invite is saved for review. Joining still needs your confirmation.</Notice><Button secondary label="Review incoming invite" onPress={() => router.push('/circles/join')} /><Button secondary label="Dismiss incoming invite" onPress={() => { repo!.setPreference('device', 'incoming_circle_invite', ''); refresh(); }} /></>}
      {items && !items.length && <Notice>No circles yet. Create a small group or join with an invite.</Notice>}
      {items?.map(c => <Row key={c.id} title={c.name} detail={`${c.member_count}/20 members${c.is_owner ? ' · Owner' : ''}`} onPress={() => router.push({ pathname: '/circles/[id]', params: { id: c.id } })} />)}
      <Button label="Create a circle" disabled={view.pending || (items?.length ?? 0) >= 5} onPress={() => router.push('/circles/create')} />
      <Button secondary label="Join with an invite" disabled={view.pending} onPress={() => router.push('/circles/join')} />
      {items?.length === 5 && <Copy>You belong to five circles. Leave one before joining another.</Copy>}
      <Button secondary label="Refresh circles" onPress={view.refresh} disabled={view.state.status === 'loading'} />
      <Copy variant="caption">Up to five circles, with twenty members each. Activity uses each circle’s fixed timezone.</Copy></>}
  </AppScreen>;
}
