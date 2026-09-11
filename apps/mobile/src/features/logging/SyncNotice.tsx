import { useRouter } from 'expo-router';
import { Button, Notice } from '../../components/ui';
import { useLocal } from '../../services/local-context';
import { useAuth } from '../../services/auth-context';
import { useSync } from '../../services/sync-context';

export function SyncNotice() {
  const { repo, partition } = useLocal(), { connection } = useAuth(), { status, repository, retry } = useSync();
  const router = useRouter();
  if (!repo || partition?.kind !== 'account') return null;
  const pending = repo.unsynced(partition.id), issues = repository?.issues().length ?? 0;
  const needsSignIn = !connection || status.code === 'UNAUTHENTICATED';
  const message = needsSignIn ? 'Sign in to reconnect. Your local check-ins are safe.'
    : status.code === 'ACCOUNT_UNAVAILABLE' ? 'Account access is unavailable. Your local check-ins are safe.'
    : status.state === 'blocked' ? 'Sync needs attention. Your local check-ins are safe.'
    : status.state === 'offline' ? 'Offline. Your check-ins are saved on this phone.'
    : status.state === 'waiting' ? 'Connecting to your account…'
    : status.state === 'syncing' ? 'Syncing your check-ins…'
    : status.state === 'retrying' ? 'Connection interrupted. We’ll retry shortly.'
    : issues ? 'Some check-ins need your choice before syncing.'
    : pending ? `${pending} check-ins waiting to sync.` : 'All check-ins synced.';
  return <><Notice>{message}</Notice>
    {pending > 0 && <Notice>{pending} check-ins haven’t synced yet.</Notice>}
    {issues > 0 && <Button secondary label="Review sync issues" onPress={() => router.push('/sync-issues')} />}
    {needsSignIn ? <Button secondary label="Sign in to sync" onPress={() => router.push('/auth')} /> : <Button secondary label="Retry sync" onPress={retry} />}
  </>;
}
