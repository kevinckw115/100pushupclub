import { useCallback, useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from './ui';
import { CircleGate, CircleNotice, CircleReadStatus } from './circle-common';
import { useLocal } from '../services/local-context';
import { useSync } from '../services/sync-context';
import { useCircleReader } from '../services/circle-reader';
import { PARTICIPATION_TERMS_VERSION, circleTimezone } from '../data/circles';
import type { HttpSyncTransport } from '../data/sync/transport';
import { theme, typography } from '../theme/theme';
export const circleInputStyle = { ...typography('body'), borderWidth: 1, borderColor: theme.colors.divider, borderRadius: theme.layout.buttonRadius, padding: theme.spacing[2], color: theme.colors.textPrimary, minHeight: theme.layout.tapTargetMin };
export function CircleForm({ mode, initialCode = '' }: { mode: 'create' | 'join'; initialCode?: string }) {
  const router = useRouter(), { repo, partition, refresh } = useLocal(), sync = useSync(), store = sync.repository?.circles, profile = sync.repository?.profile.cached();
  const pending = store?.pending(), request = pending?.request;
  const [name, setName] = useState(request?.operation === 'create_circle' ? request.envelope.name : '');
  const [zone, setZone] = useState(request?.operation === 'create_circle' ? request.envelope.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [code, setCode] = useState(request?.operation === 'join_circle' ? request.envelope.code : initialCode || repo?.preference('device', 'incoming_circle_invite') || '');
  useEffect(() => { if (mode === 'join' && /^pc_[a-f0-9]{64}$/.test(initialCode) && repo) repo.setPreference('device', 'incoming_circle_invite', initialCode); }, [mode, initialCode, repo]);
  const [previewCode, setPreviewCode] = useState(''), [consent, setConsent] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(request?.operation === (mode === 'create' ? 'create_circle' : 'join_circle') ? request.envelope.operation_id : null);
  const read = useCallback((t: HttpSyncTransport, signal: AbortSignal) => t.previewInvite(previewCode, signal), [previewCode]);
  const preview = useCircleReader(read, mode === 'join' && !!previewCode && code.trim().toLowerCase() === previewCode), last = store?.last();
  const accepted = last?.receipt.operation_id === submitted && 'circle' in last.receipt ? last.receipt.circle : null;
  const eligible = profile?.status === 'active' && !profile.alias_change_required && profile.participation_terms_version === PARTICIPATION_TERMS_VERSION && !sync.repository?.profile.pending();
  const submit = () => {
    try {
      if (!store || !eligible || !consent) return;
      if (mode === 'create') { circleTimezone(zone); store.queue('create_circle', { name, timezone: zone, accept_circle_sharing: true }); }
      else { if (!preview.state.value || previewCode !== code.trim().toLowerCase()) return; store.queue('join_circle', { code: previewCode, accept_circle_sharing: true }); repo?.setPreference('device', 'incoming_circle_invite', ''); }
      setSubmitted(store.pending()!.request.envelope.operation_id); setMessage(null); refresh(); sync.retry();
    } catch { setMessage(mode === 'create' ? 'Check the name (3–40 characters) and a valid IANA timezone, then try again.' : 'Could not save this request. Check the invite and try again.'); }
  };
  return <AppScreen><Header /><Copy variant="title">{mode === 'create' ? 'Create a circle' : 'Join a circle'}</Copy><CircleGate /><CircleNotice />
    {partition?.kind === 'account' && store && <>
      {!eligible && <><Notice>Review your alias and accept community participation terms before joining a circle.</Notice><Button secondary label="Review alias and participation" onPress={() => router.push('/sharing')} /></>}
      {profile && <Copy>Your circle alias: {profile.alias}</Copy>}
      {mode === 'create' ? <>
        <Copy>Circle name</Copy><TextInput accessibilityLabel="Circle name" value={name} onChangeText={setName} editable={!pending} maxLength={40} style={circleInputStyle} />
        <Copy>Fixed timezone</Copy><TextInput accessibilityLabel="Circle timezone" value={zone} onChangeText={setZone} editable={!pending} maxLength={100} autoCapitalize="none" autoCorrect={false} style={circleInputStyle} />
        <Copy variant="caption">For example, America/Los_Angeles. This cannot change after creation. Your personal day keeps its own recorded timezone.</Copy>
      </> : <>
        <Copy>Invite code</Copy><TextInput accessibilityLabel="Invite code" value={code} onChangeText={value => { setCode(value); setConsent(false); }} editable={!pending} maxLength={200} autoCapitalize="none" autoCorrect={false} style={circleInputStyle} />
        <Button secondary label="Preview invite" disabled={!!pending} onPress={() => { const normalized = code.trim().toLowerCase(); if (!/^pc_[a-f0-9]{64}$/.test(normalized)) { setMessage('Paste the complete invite code beginning with pc_.'); return; } setMessage(null); if (normalized === previewCode) preview.refresh(); else setPreviewCode(normalized); }} />
        {!!previewCode && <CircleReadStatus state={preview.state} />}
        {preview.state.value && <Section title={preview.state.value.name}><Copy>{preview.state.value.member_count}/20 members · {preview.state.value.timezone}</Copy><Copy variant="caption">Expires in about {Math.max(1, Math.ceil(preview.state.value.expires_in_seconds / 3600))} hours.</Copy></Section>}
      </>}
      <Notice>Members can see your new check-ins while you’re in this circle. Only activity after joining is shared, using this circle’s day. Imported history stays private. Public Club sharing is a separate choice.</Notice>
      <Button secondary label={consent ? 'Circle sharing accepted' : 'Accept circle sharing'} disabled={!!pending} onPress={() => setConsent(!consent)} />
      {message && <Notice error>{message}</Notice>}
      <Button label={mode === 'create' ? 'Create my circle' : 'Join this circle'} disabled={!eligible || !consent || !!pending || !!accepted || (mode === 'join' && !preview.state.value)} onPress={submit} />
      {accepted && <><Notice>Your request was confirmed. Open the circle to check current membership and activity.</Notice><Button label="Open circle" onPress={() => router.replace({ pathname: '/circles/[id]', params: { id: accepted.id } })} /></>}
    </>}
    <Button secondary label="Back to circles" onPress={() => router.replace('/(tabs)/circles')} />
  </AppScreen>;
}
