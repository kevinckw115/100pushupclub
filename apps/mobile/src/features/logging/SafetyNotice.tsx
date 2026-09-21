import { Button, Copy, Notice } from '../../components/ui';
import { useLocal } from '../../services/local-context';
import { useSync } from '../../services/sync-context';
import { Fragment, useState } from 'react';
export function SafetyNotice() {
  const { repo, partition, refresh } = useLocal(), sync = useSync();
  const [failed, setFailed] = useState(false);
  if (!repo || partition?.kind !== 'account' || !sync.repository) return null;
  const requests = sync.repository.safety.all();
  if (!requests.length) return repo.preference(partition.id, 'safety_receipt') ? <Notice>Your last safety request was confirmed. Current activity and blocked accounts refresh from the server.</Notice> : <Copy>Reports are private and do not automatically remove activity. Block an account to hide its activity for you.</Copy>;
  return <>{requests.map(pending => <Fragment key={pending.request.envelope.operation_id}>
    <Copy variant="caption">{pending.request.operation === 'report_subject' ? 'Report request' : 'Account block change'}</Copy>
    {pending.state === 'rejected' ? <><Notice error>{pending.code === 'NOT_FOUND_OR_FORBIDDEN' ? 'This subject is no longer available to you. Refresh activity before choosing another request.' : 'This request was not accepted. Dismiss it and review your choice.'}</Notice><Button secondary label={pending.request.operation === 'report_subject' ? 'Dismiss rejected report' : 'Dismiss rejected block change'} onPress={() => { try { sync.repository!.safety.discardRejected(pending.request.envelope.operation_id); setFailed(false); refresh(); } catch { setFailed(true); } }} /></> : <Notice>Request saved on this phone; server confirmation is pending. {pending.code === 'RATE_LIMITED' ? 'The server asked us to wait before trying again.' : 'It will retry when connected.'}</Notice>}
  </Fragment>)}<Button secondary label="Retry safety request" onPress={sync.retry} />{failed && <Notice error>Could not clear this request. Please retry.</Notice>}</>;
}
