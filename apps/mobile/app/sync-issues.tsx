import { useState } from 'react';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section, QuantityInput } from '../src/components/ui';
import { useSync } from '../src/services/sync-context';
import { deviceTimezone, useLocal } from '../src/services/local-context';
import { quantity } from '../src/domain/checkin';
import type { SyncRepository } from '../src/data/sync/repository';

function Issue({ id, repository }: { id: string; repository: SyncRepository }) {
  const { refresh } = useLocal();
  const { local, remote, code } = repository.details(id);
  const [draft, setDraft] = useState(String(local.quantity)), [message, setMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'mine' | 'replace' | null>(null);
  const perform = (action: 'account' | 'mine' | 'delete' | 'replace' | 'retry', confirmed = false) => {
    let committed = false;
    try {
      if ((action === 'mine' || action === 'replace') && quantity(draft) > 100 && !confirmed) { setConfirmation(action); return; }
      if (action === 'account') repository.useAccount(id);
      else if (action === 'mine' || action === 'delete') repository.applyMine(id, draft, action === 'delete');
      else if (action === 'replace') repository.replacePrivately(id, draft, new Date().toISOString(), deviceTimezone());
      else repository.retryIssue(id);
      committed = true; refresh();
    } catch (error) { setMessage(committed ? 'Your choice is saved locally. Reopen this screen to refresh it.' : error instanceof Error && error.message.startsWith('Enter a whole') ? error.message : 'Could not save your choice. Nothing has been discarded.'); }
  };
  const reason = code === 'CLOCK_AHEAD' ? 'The recorded time is ahead of the server. Check your phone’s clock, then retry.'
    : code === 'INVALID_TIMEZONE' || code === 'INVALID_LOCAL_DATE' ? 'The recorded date or time zone could not be accepted. You can keep it here or save a new private check-in now.'
    : code === 'ENTITY_EXISTS' ? 'This check-in conflicts with a different check-in in your account. Choose which value to keep.'
    : remote?.deleted_at ? 'This check-in was deleted in your account. You can save your value as a new check-in.'
    : remote ? 'This check-in changed on another device.' : 'Your account could not accept this check-in. Your local value is still here.';
  return <Section title={`Recorded ${local.local_date}`}>
    <Copy>{reason}</Copy>
    <Copy>On this phone: {local.deleted ? 'deleted' : `${local.quantity} pushups`}</Copy>
    {remote && <Copy>In your account: {remote.deleted_at ? 'deleted' : `${remote.quantity} pushups`}</Copy>}
    <QuantityInput value={draft} onChange={setDraft} />
    {confirmation ? <><Copy>Save {draft} pushups?</Copy><Button label="Confirm choice" onPress={() => perform(confirmation, true)} /><Button secondary label="Keep editing" onPress={() => setConfirmation(null)} /></> : <>
      <Button secondary label={remote ? 'Use account value' : 'Discard local check-in'} onPress={() => perform('account')} />
      {remote && !remote.deleted_at && code !== 'ENTITY_EXISTS' ? <>
        <Button label="Apply my value" onPress={() => perform('mine')} />
        {local.deleted === 1 && <Button secondary label="Apply my deletion" onPress={() => perform('delete')} />}
      </> : <><Copy>A replacement is a new check-in recorded now. It stays out of the public feed.</Copy><Button label="Save new private check-in" onPress={() => perform('replace')} /></>}
      {!['VERSION_CONFLICT', 'ENTITY_EXISTS'].includes(code) && <Button secondary label="Retry original request" onPress={() => perform('retry')} />}
    </>}
    {message && <Notice error>{message}</Notice>}
  </Section>;
}

export default function SyncIssues() {
  const { repository } = useSync(), router = useRouter();
  const issues = repository?.issues() ?? [];
  return <AppScreen><Header /><Copy variant="title">Your sync choices</Copy><Copy>Keep the account value or choose what to send. Your local changes stay visible until you decide.</Copy>
    {repository && issues.map(issue => repository.imports.job(issue.entity_id)?.state === 'conflict'
      ? <Button key={issue.entity_id} secondary label="Review guest import choice" onPress={() => router.push('/guest-import')} />
      : <Issue key={issue.entity_id} id={issue.entity_id} repository={repository} />)}
    {!issues.length && <Notice>No sync issues to review.</Notice>}
    <Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/today')} />
  </AppScreen>;
}
