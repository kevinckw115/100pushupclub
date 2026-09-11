import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
import { useLocal } from '../src/services/local-context';
import { useSync } from '../src/services/sync-context';
import { SafetyNotice } from '../src/features/logging/SafetyNotice';
import type { ReportMutation } from '../src/data/safety';
const reasons = [['abuse', 'Abuse or harassment'], ['impersonation', 'Impersonation'], ['inappropriate_name', 'Inappropriate name'], ['other', 'Other concern']] as const;
export default function Safety() {
  const router = useRouter(), params = useLocalSearchParams<{ actor_id?: string; entry_id?: string; circle_id?: string }>();
  const { partition, refresh } = useLocal(), sync = useSync();
  const [subject, setSubject] = useState<'alias' | 'checkin' | 'circle_name'>(params.circle_id ? 'circle_name' : params.actor_id ? 'alias' : 'checkin');
  const [reason, setReason] = useState<ReportMutation['reason']>('abuse'), [confirm, setConfirm] = useState(false), [error, setError] = useState(false);
  const actor = typeof params.actor_id === 'string' && /^a_[0-9a-f]{32}$/.test(params.actor_id) ? params.actor_id : null;
  const entry = typeof params.entry_id === 'string' && /^e_[0-9a-f]{32}$/.test(params.entry_id) ? params.entry_id : null;
  const circle = typeof params.circle_id === 'string' && /^[0-9a-f-]{36}$/.test(params.circle_id) ? params.circle_id : null;
  const store = sync.repository?.safety, pending = store?.all().some(p => p.request.operation === 'report_subject');
  const pendingBlock = store?.all().some(p => p.request.operation !== 'report_subject');
  const report = () => {
    const id = subject === 'alias' ? actor : subject === 'checkin' ? entry : circle; if (!id || !store) return;
    try { store.queue('report_subject', { subject_type: subject, subject_id: id, reason }); setError(false); refresh(); sync.retry(); } catch { setError(true); }
  };
  return <AppScreen><Header /><Copy variant="title">Report or block</Copy>
    {partition?.kind !== 'account' ? <><Copy>Sign in to report a concern or block an account.</Copy><Button label="Sign in" onPress={() => router.push('/auth')} /></> : <>
      <SafetyNotice />
      {(actor || entry || circle) && <Section title="Report a concern">
        {actor && <Button label="Report this alias" secondary={subject !== 'alias'} onPress={() => setSubject('alias')} disabled={!!pending} />}
        {entry && <Button label="Report this check-in" secondary={subject !== 'checkin'} onPress={() => setSubject('checkin')} disabled={!!pending} />}
        {circle && <Button label="Report this circle name" secondary={subject !== 'circle_name'} onPress={() => setSubject('circle_name')} disabled={!!pending} />}
        <Copy>Choose the reason that best fits.</Copy>
        {reasons.map(([value, label]) => <Button key={value} secondary={reason !== value} label={label} onPress={() => setReason(value)} disabled={!!pending} />)}
        <Button label="Send report" onPress={report} disabled={!!pending} />
      </Section>}
      {actor && <Section title="Block this account"><Copy>You will not see each other’s public or circle activity. Blocking does not change circle membership.</Copy>
        {confirm ? <><Button label="Confirm block" disabled={!!pendingBlock} onPress={() => { try { store!.queue('block_user', { actor_id: actor }); setConfirm(false); setError(false); refresh(); sync.retry(); } catch { setError(true); } }} /><Button secondary label="Keep this account visible" onPress={() => setConfirm(false)} /></> : <Button secondary label="Block account" onPress={() => setConfirm(true)} disabled={!!pendingBlock} />}
      </Section>}
      <Button secondary label="View blocked accounts" onPress={() => router.push('/blocked')} />
    </>}
    {error && <Notice error>Could not save this request on your phone. Your choice is still here; please retry.</Notice>}
    <Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/club')} />
  </AppScreen>;
}
