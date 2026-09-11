import { useCallback } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section, IconButton } from '../../../src/components/ui';
import { CircleGate, CircleNotice, CircleReadStatus } from '../../../src/components/circle-common';
import { useCircleReader } from '../../../src/services/circle-reader';
import type { HttpSyncTransport } from '../../../src/data/sync/transport';
import { theme } from '../../../src/theme/theme';
export default function CircleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(), router = useRouter();
  const read = useCallback((t: HttpSyncTransport, signal: AbortSignal) => t.circleToday(id, signal), [id]);
  const view = useCircleReader(read), c = view.state.value?.circle;
  return <AppScreen><Header /><Copy variant="title">{c?.name ?? 'Your circle'}</Copy><CircleGate /><CircleNotice />
    {view.connected && <><CircleReadStatus state={view.state} />{c && <>
      <Copy variant="caption">{c.local_date} · {c.timezone} · Fixed circle timezone</Copy>
      {c.name_change_required && <Notice>The circle name needs review. Its owner can choose a new name in Manage circle.</Notice>}
      <Section><Copy variant="headline" accessibilityLabel={`${c.total_reps} circle pushups today`}>{c.total_reps}</Copy><Copy>Pushups today · {c.checked_in_count} of {c.active_member_count} members checked in</Copy></Section>
      {c.hidden_activity && <Notice>Some activity is hidden. The member count includes all current members.</Notice>}
      <Section title="Showing up together">{c.members.map(m => <View key={m.member_id} style={{ borderBottomWidth: 1, borderColor: theme.colors.divider, paddingVertical: theme.spacing[2], gap: theme.spacing[1] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}><Copy variant="section" style={{ flex: 1 }}>{m.username}{m.is_self ? ' · You' : ''}</Copy>{!m.is_self && <IconButton name="ellipsis-horizontal" label={`Report or block ${m.username}`} onPress={() => router.push({ pathname: '/safety', params: { actor_id: m.member_id, circle_id: c.id } })} />}</View>
        <Copy>{m.checked_in ? `${m.total_reps} pushups today` : 'No check-in yet today'}</Copy>
      </View>)}</Section>
      <Copy variant="caption">Alphabetical by alias. Only activity within your current membership is included. Refreshes while this screen is open.</Copy>
      <Button secondary label="Manage circle" onPress={() => router.push({ pathname: '/circles/[id]/manage', params: { id: c.id } })} />
      <Button secondary label="Report circle name" onPress={() => router.push({ pathname: '/safety', params: { circle_id: c.id } })} />
    </>}<Button secondary label="Refresh circle" onPress={view.refresh} disabled={view.state.status === 'loading'} /></>}
    <Button secondary label="Back to circles" onPress={() => router.replace('/(tabs)/circles')} />
  </AppScreen>;
}
