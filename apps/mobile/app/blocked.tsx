import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
import { useLocal } from '../src/services/local-context';
import { useAuth } from '../src/services/auth-context';
import { useSync } from '../src/services/sync-context';
import { authEnvironment } from '../src/services/auth-client';
import { HttpSyncTransport } from '../src/data/sync/transport';
import type { BlockPage } from '../src/data/safety';
import { SafetyNotice } from '../src/features/logging/SafetyNotice';
export default function Blocked() {
  const router = useRouter(), { repo, partition, refresh } = useLocal(), { connection } = useAuth(), sync = useSync();
  const [after, setAfter] = useState<string | null>(null), [attempt, setAttempt] = useState(0), [confirm, setConfirm] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [result, setResult] = useState<{ key: string; page: BlockPage | null }>({ key: '', page: null });
  const client = useMemo(() => connection && authEnvironment.connected ? new HttpSyncTransport(authEnvironment.url!, authEnvironment.key!, connection) : null, [connection]);
  const key = JSON.stringify([partition?.id, after, attempt, repo?.preference(partition?.id ?? '', 'safety_receipt')]);
  useEffect(() => {
    if (!client) return;
    const abort = new AbortController();
    void client.listBlocks(after, abort.signal).then(page => { if (!abort.signal.aborted) setResult({ key, page }); }, () => { if (!abort.signal.aborted) setResult({ key, page: null }); });
    return () => abort.abort();
  }, [client, after, key]);
  const pending = sync.repository?.safety.all().some(p => p.request.operation !== 'report_subject');
  return <AppScreen><Header /><Copy variant="title">Blocked accounts</Copy>
    {partition?.kind !== 'account' || !client ? <><Notice>Reconnect your account to review current blocks.</Notice><Button label="Sign in" onPress={() => router.push('/auth')} /></> : <>
      <SafetyNotice />
      {result.key !== key ? <Copy>Loading current blocked accounts…</Copy> : !result.page ? <Notice error>Could not load blocked accounts. Connect and refresh to try again.</Notice> : <>
        {!result.page.items.length && <Copy>{after ? 'No more blocked accounts.' : 'No blocked accounts.'}</Copy>}
        {result.page.items.map(item => <Section key={item.actor_id} title={item.alias}>
          {confirm === item.actor_id ? <><Copy>Allow this account’s activity to appear again?</Copy><Button label={`Confirm unblock ${item.alias}`} disabled={!!pending} onPress={() => { try { sync.repository!.safety.queue('unblock_user', { actor_id: item.actor_id }); setConfirm(null); setSaveError(false); refresh(); sync.retry(); } catch { setSaveError(true); } }} /><Button secondary label="Keep blocked" onPress={() => setConfirm(null)} /></> : <Button secondary label={`Unblock ${item.alias}`} disabled={!!pending} onPress={() => setConfirm(item.actor_id)} />}
        </Section>)}
        {result.page.next_actor && <Button secondary label="Next blocked accounts" onPress={() => { setAfter(result.page!.next_actor); setConfirm(null); }} />}
      </>}
      <Button secondary label="Refresh blocked accounts" onPress={() => { setAfter(null); setAttempt(value => value + 1); setConfirm(null); }} />
    </>}
    {saveError && <Notice error>Could not save the unblock request. The account is still blocked; please retry.</Notice>}
    <Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} />
  </AppScreen>;
}
