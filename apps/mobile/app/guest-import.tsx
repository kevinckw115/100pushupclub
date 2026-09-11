import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
import { useLocal } from '../src/services/local-context';
import { ImportRepository } from '../src/data/local/imports';
import { SyncNotice } from '../src/features/logging/SyncNotice';

export default function GuestImport() {
  const { repo, partition, refresh } = useLocal(), router = useRouter();
  const account = partition?.kind === 'account' ? partition.id : null;
  const imports = useMemo(() => repo && account ? new ImportRepository(repo, account) : null, [repo, account]);
  const [selected, setSelected] = useState<string[]>([]), [confirm, setConfirm] = useState<'import' | 'cleanup' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const available = imports?.available() ?? [], counts = imports?.counts() ?? {};
  const perform = (work: () => void, success: string) => {
    let committed = false;
    try { work(); committed = true; refresh(); setSelected([]); setConfirm(null); setMessage(success); }
    catch { setMessage(committed ? 'Your choice is saved. Reopen this screen to refresh it.' : 'Could not save this choice. Your guest check-ins are still here.'); }
  };
  return <AppScreen><Header /><Copy variant="title">Bring your guest check-ins</Copy>
    <Copy>Copy selected check-ins into your signed-in account. Their original dates stay the same. Imported history stays private and is excluded from circles. Guest copies stay on this phone until you choose cleanup.</Copy>
    {!imports ? <Notice>Sign in before importing guest check-ins.</Notice> : <>
      <SyncNotice />
      <Copy>{counts.acknowledged ?? 0} confirmed · {counts.pending ?? 0} waiting · {counts.conflict ?? 0} need a choice</Copy>
      {(counts.paused ?? 0) > 0 && <><Copy>Some imports were paused when you signed out. Resume them only if you want their copies in this account.</Copy><Button label="Resume paused imports" onPress={() => perform(() => imports.resumePaused(), 'Imports resumed. Guest copies are unchanged.')} /></>}
      {imports.jobs('paused').map(job => { const source = JSON.parse(job.snapshot_json); return <Section key={job.source_id} title={`Paused: ${source.local_date}`}><Copy>{source.quantity} guest pushups. Stopping retries keeps the guest copy; an account copy may already have been accepted before sign-out.</Copy><Button secondary label="Stop retrying this import" onPress={() => perform(() => imports.resolve(job.destination_id, 'keep'), 'Retries stopped. Guest history is unchanged.')} /></Section>; })}
      {imports.jobs('conflict').map(job => {
        const source = JSON.parse(job.snapshot_json), remote = job.remote_json ? JSON.parse(job.remote_json) : null;
        return <Section key={job.source_id} title={`Guest check-in: ${source.local_date}`}>
          <Copy>{source.quantity} pushups in guest history.</Copy>
          <Copy>{remote ? `The account already has ${remote.deleted_at ? 'a deleted check-in' : `${remote.quantity} pushups`} for this record.` : 'This import could not be accepted. Your guest record remains unchanged.'}</Copy>
          <Button secondary label="Keep guest only" onPress={() => perform(() => imports.resolve(job.destination_id, 'keep'), 'Import cancelled. Your guest record is unchanged.')} />
          {['ENTITY_EXISTS', 'NOT_FOUND_OR_FORBIDDEN'].includes(job.code ?? '')
            ? <Button label="Import as separate private check-in" onPress={() => perform(() => imports.resolve(job.destination_id, 'separate'), 'A separate private import is queued.')} />
            : <><Copy>Check your phone’s date and time, then retry the original import.</Copy><Button label="Retry import" onPress={() => perform(() => imports.resolve(job.destination_id, 'retry'), 'Import queued for retry.')} /></>}
        </Section>;
      })}
      <Section title="Choose guest check-ins">
        <Copy>Up to 50 are shown at a time. Choosing another account always requires a new import choice.</Copy>
        {available.map(row => <Button key={row.id} secondary label={`${selected.includes(row.id) ? 'Selected: ' : 'Select: '}${row.quantity} pushups · ${row.local_date}`} onPress={() => setSelected(ids => ids.includes(row.id) ? ids.filter(id => id !== row.id) : [...ids, row.id])} />)}
        {!available.length && <Notice>No new guest check-ins to import.</Notice>}
        {selected.length > 0 && <Button label={`Review ${selected.length} selected check-ins`} onPress={() => setConfirm('import')} />}
        {confirm === 'import' && <><Copy>Copy these {selected.length} check-ins privately into this account?</Copy><Button label="Confirm private import" onPress={() => perform(() => imports.start(available.filter(row => selected.includes(row.id)).map(row => ({ partition: row.partition_id, id: row.id }))), 'Import saved locally and queued. Guest copies are unchanged.')} /><Button secondary label="Keep choosing" onPress={() => setConfirm(null)} /></>}
      </Section>
      {(counts.acknowledged ?? 0) > 0 && <Section title="Optional guest cleanup">
        <Copy>After selected imports finish, remove up to 50 unchanged guest copies already confirmed in this account. Guest edits made since import are kept. You can also keep every guest copy.</Copy>
        <Button secondary label="Review guest cleanup" onPress={() => setConfirm('cleanup')} />
        {confirm === 'cleanup' && <><Copy>Remove confirmed guest copies from this phone? Account copies remain.</Copy><Button label="Remove confirmed guest copies" onPress={() => { let removed = 0; perform(() => { removed = imports.cleanup(); }, 'Cleanup saved. Changed guest records were kept.'); if (removed) setMessage(`${removed} confirmed guest copies removed. Changed guest records were kept.`); }} /><Button secondary label="Keep guest copies" onPress={() => setConfirm(null)} /></>}
      </Section>}
    </>}
    {message && <Notice>{message}</Notice>}
    <Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/today')} />
  </AppScreen>;
}
