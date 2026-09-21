import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { getRandomBytesAsync } from 'expo-crypto';
import * as Network from 'expo-network';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
import { circleInputStyle } from '../src/components/circle-form';
import { useLocal } from '../src/services/local-context';
import { useAuth } from '../src/services/auth-context';
import { authEnvironment } from '../src/services/auth-client';
import { DeletionRepository } from '../src/data/local/deletion';
import { deletionPost } from '../src/data/account-privacy';
import { SyncFailure } from '../src/data/sync/protocol';
export default function DeleteAccount() {
  const router = useRouter(), { repo, refresh } = useLocal(), auth = useAuth(), store = useMemo(() => repo ? new DeletionRepository(repo) : null, [repo]);
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [wait, setWait] = useState(0);
  const [ownershipVerified, setOwnershipVerified] = useState(false);
  const verified = useRef<{ userId: string; token: string } | null>(null), lock = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; verified.current = null; }; }, []);
  useEffect(() => { if (!wait) return; const timer = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(timer); }, [wait]);
  const pending = store?.pending();
  const run = async (action: 'send' | 'verify' | 'delete' | 'status') => {
    if (lock.current || !store || !authEnvironment.connected) return; lock.current = true; setBusy(true); setMessage(null);
    try {
      const network = await Network.getNetworkStateAsync(); if (network.isConnected === false || network.isInternetReachable === false) throw new Error('Connect to the internet before continuing.');
      if (action === 'send') { await auth.send(email.trim(), true); if (live.current) { setSent(true); setWait(60); setMessage('Check your email for a deletion verification code.'); } }
      else if (action === 'verify') {
        const value = await auth.verifyDeletion(email, code); const current = store.pending();
        if (current && current.accountId !== value.userId) throw new Error('Use the original account email for this deletion request.');
        if (live.current) { verified.current = value; setOwnershipVerified(true); setMessage('Ownership verified. Review the deletion scope, then confirm.'); }
      } else {
        if (action === 'delete') {
          if (!verified.current || !confirmed) return;
          if (!store.pending()) { const bytes = await getRandomBytesAsync(32); store.begin(verified.current.userId, 'd_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')); }
          store.retry(); refresh();
        }
        const current = store.pending(); if (!current) return;
        const result = action === 'status' ? await deletionPost(authEnvironment.url!, authEnvironment.key!, 'account_deletion_status', { status_token: current.request.status_token })
          : await deletionPost(authEnvironment.url!, authEnvironment.key!, 'request_account_deletion', { envelope: current.request }, verified.current!.token);
        store.acknowledge(current.request.operation_id, result); refresh();
        await auth.finishDeletion(current.accountId);
        if (live.current) setMessage(result.status === 'complete' ? 'Your primary account data has been deleted.' : 'Deletion accepted. Your account is hidden and cleanup is processing.');
      }
    } catch (error) {
      if (action === 'delete' && error instanceof SyncFailure && [400, 401, 403, 409].includes(error.status)) { store.reject(error.code); refresh(); }
      if (live.current) setMessage(error instanceof SyncFailure ? error.code === 'REAUTH_REQUIRED' ? 'Request and verify a new email code before confirming deletion.' : error.status === 404 ? 'This request is not confirmed yet. Reverify the original account and retry the same deletion request.' : error.code === 'RATE_LIMITED' ? 'Please wait before checking again.' : 'Could not confirm deletion. Keep this device’s recovery record and check status when connected.' : error instanceof Error ? error.message : 'Could not continue. Please retry.');
    } finally { lock.current = false; if (live.current) setBusy(false); }
  };
  return <AppScreen><Header /><Copy variant="title">Delete account</Copy>
    <Notice>This deletes your cloud account, check-ins, sharing settings and memberships. Owned circles transfer to the earliest eligible member or are deleted if none remains. Separate guest check-ins on this device stay. Export your data first if you want a copy.</Notice>
    <Copy>After acceptance, account access stops immediately. Primary cleanup has a seven-day operational target. Provider backups and minimal moderation audits follow the published retention policy.</Copy>
    <Button secondary label="Export my data first" onPress={() => router.push('/export')} />
    {!authEnvironment.connected && <Notice>Account deletion is not connected in this local build. Guest data has not been submitted to a server.</Notice>}
    {pending && <Section title="Saved deletion request"><Notice>{pending.phase === 'complete' ? 'Primary account cleanup is complete.' : pending.phase === 'acknowledged' ? 'Deletion accepted. Primary cleanup is processing.' : 'This device has an unconfirmed deletion request. Its recovery proof is kept locally; check status before retrying.'}</Notice>
      <Button secondary label="Check deletion status" onPress={() => { void run('status'); }} busy={busy} />
      {['rejected', 'complete'].includes(pending.phase) && <Button secondary label={pending.phase === 'complete' ? 'Remove completed recovery record' : 'Dismiss rejected deletion request'} onPress={() => { store!.dismiss(); refresh(); }} />}
    </Section>}
    {authEnvironment.connected && (!pending || ['pending', 'rejected'].includes(pending.phase)) && <Section title="Verify account ownership">
      <Copy>Use your account email. An email address alone never authorizes deletion.</Copy>
      <TextInput accessibilityLabel="Deletion account email" value={email} onChangeText={setEmail} editable={!sent && !busy} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={circleInputStyle} />
      <Button secondary label={wait ? `Request another code in ${wait}s` : 'Send deletion verification code'} disabled={wait > 0} busy={busy} onPress={() => { void run('send'); }} />
      {sent && <><TextInput accessibilityLabel="Deletion verification code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={10} style={circleInputStyle} /><Button secondary label="Verify deletion code" busy={busy} onPress={() => { void run('verify'); }} /></>}
      {ownershipVerified && <><Button secondary label={confirmed ? 'Deletion scope confirmed' : 'I understand what will be deleted'} onPress={() => setConfirmed(!confirmed)} /><Button label="Confirm account deletion" disabled={!confirmed} busy={busy} onPress={() => { void run('delete'); }} /></>}
    </Section>}
    {message && <Notice>{message}</Notice>}
    <Button secondary label="Back to Settings" onPress={() => router.replace('/settings')} />
  </AppScreen>;
}
