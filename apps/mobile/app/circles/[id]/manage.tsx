import { useCallback, useState } from 'react';
import { Share, TextInput } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../../../src/components/ui';
import { CircleGate, CircleNotice, CircleReadStatus } from '../../../src/components/circle-common';
import { circleInputStyle } from '../../../src/components/circle-form';
import { useCircleReader } from '../../../src/services/circle-reader';
import { useLocal } from '../../../src/services/local-context';
import { useSync } from '../../../src/services/sync-context';
import type { HttpSyncTransport } from '../../../src/data/sync/transport';
import type { ManageCircle } from '../../../src/data/circles';
type Action = Omit<ManageCircle, 'operation_id' | 'circle_id'> & { member_id?: string; invite_id?: string; name?: string };
export default function Manage() {
  const { id } = useLocalSearchParams<{ id: string }>(), router = useRouter(), { refresh } = useLocal(), sync = useSync();
  const [confirmation, setConfirmation] = useState<{ label: string; action: Action } | null>(null), [name, setName] = useState(''), [message, setMessage] = useState<string | null>(null);
  const read = useCallback(async (t: HttpSyncTransport, signal: AbortSignal) => { const detail = await t.circleToday(id, signal); return { ...detail, invites: detail.circle.is_owner ? (await t.circleInvites(id, signal)).items : [] }; }, [id]);
  const view = useCircleReader(read), c = view.state.value?.circle, store = sync.repository?.circles, last = store?.last();
  const invitation = last?.operation === 'create_invite' && 'invite' in last.receipt && last.receipt.circle_id === id && c?.is_owner && view.state.value?.invites.some(i => i.id === ('invite' in last.receipt ? last.receipt.invite.id : '')) ? last.receipt.invite : null;
  const queue = (action?: Action) => { try { if (!store || !c) return; if (action) store.queue('manage_circle', { circle_id: id, ...action }); else store.queue('create_invite', { circle_id: id }); setConfirmation(null); setMessage(null); refresh(); sync.retry(); } catch { setMessage('Could not save this request. Review the fields and try again.'); } };
  const confirm = (label: string, action: Action) => { setConfirmation({ label, action }); setMessage(null); };
  return <AppScreen><Header /><Copy variant="title">Manage circle</Copy><CircleGate /><CircleNotice />
    {message && <Notice>{message}</Notice>}
    {view.connected && <><CircleReadStatus state={view.state} />{c && <>
      <Copy variant="section">{c.name}</Copy><Copy variant="caption">{c.timezone} · Fixed timezone</Copy>
      {confirmation && <Section><Notice>{confirmation.label} This change applies to current circle access.</Notice><Button label={`Confirm ${confirmation.action.action.replace('_', ' ')}`} onPress={() => queue(confirmation.action)} /><Button secondary label="Cancel change" onPress={() => setConfirmation(null)} /></Section>}
      {c.is_owner ? <>
        <Section title="Invitations"><Copy>Anyone with a valid code can request to join. Codes expire after seven days. Share only with people you want in this circle.</Copy>
          <Button label="Create invite code" disabled={view.pending || c.name_change_required || (view.state.value?.invites.length ?? 0) >= 5} onPress={() => queue()} />
          {invitation && <><Copy selectable accessibilityLabel="Current invite code">{invitation.code}</Copy>
            <Button secondary label="Copy invite code" onPress={() => { void Clipboard.setStringAsync(invitation.code).then(ok => setMessage(ok ? 'Invite code copied.' : 'Could not copy. Select the code to copy it manually.'), () => setMessage('Could not copy. Select the code to copy it manually.')); }} />
            <Button secondary label="Share invite code" onPress={() => { void Share.share({ message: `Join my 100pushupclub circle with this invite code: ${invitation.code}` }).catch(() => setMessage('Sharing is unavailable here. Use Copy invite code.')); }} />
          </>}
          {view.state.value?.invites.map((i, index) => <Section key={i.id}><Copy>Invite {index + 1} · expires {new Date(i.expires_at).toLocaleDateString()}</Copy><Button secondary label={`Revoke invite ${index + 1}`} onPress={() => confirm('Revoke this invite?', { action: 'revoke_invite', invite_id: i.id })} /></Section>)}
        </Section>
        <Section title="Circle name"><TextInput accessibilityLabel="New circle name" value={name} onChangeText={setName} maxLength={40} style={circleInputStyle} /><Button secondary label="Rename circle" disabled={name.trim().length < 3} onPress={() => confirm(`Rename this circle to ${name.trim()}?`, { action: 'rename', name })} /></Section>
        <Section title="Members">{c.members.filter(m => !m.is_self).map(m => <Section key={m.member_id} title={m.username}>
          <Button secondary label={`Remove ${m.username}`} onPress={() => confirm(`Remove ${m.username}? Their activity and access will leave this circle.`, { action: 'remove', member_id: m.member_id })} />
          <Button secondary label={`Transfer ownership to ${m.username}`} onPress={() => confirm(`Make ${m.username} the owner? You will become a regular member and existing invites will be revoked.`, { action: 'transfer', member_id: m.member_id })} />
        </Section>)}{c.hidden_activity && <Copy>Some members are hidden by safety settings. Review blocked accounts to manage them.</Copy>}</Section>
        <Copy>Transfer ownership before leaving. You can also delete the circle for everyone.</Copy>
        <Button secondary label="Delete circle" onPress={() => confirm('Delete this circle for everyone? Personal check-ins stay in each member’s own history.', { action: 'delete' })} />
      </> : <Button secondary label="Leave circle" onPress={() => confirm('Leave this circle? Your activity will disappear here; rejoining starts a new membership interval.', { action: 'leave' })} />}
    </>}<Button secondary label="Refresh circle management" onPress={view.refresh} disabled={view.state.status === 'loading'} /></>}
    <Button secondary label="Back to circle" onPress={() => router.replace({ pathname: '/circles/[id]', params: { id } })} />
    <Button secondary label="Back to circles" onPress={() => router.replace('/(tabs)/circles')} />
  </AppScreen>;
}
