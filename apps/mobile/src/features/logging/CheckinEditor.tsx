import { useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { BottomSheet, Button, Copy, Notice, QuantityInput } from '../../components/ui';
import { quantity } from '../../domain/checkin';
import { deviceTimezone, useLocal } from '../../services/local-context';
import type { LocalCheckin } from '../../data/local/repository';
import { confirmLocalCommit } from '../../services/haptics';

export function CheckinEditor({ record, onClose, onSaved }: { record?: LocalCheckin; onClose: () => void; onSaved: (result: LocalCheckin, created: boolean) => void }) {
  const { repo, partition, date } = useLocal();
  const [value, setValue] = useState(record ? String(record.quantity) : '10');
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'large' | 'delete' | null>(null);
  const [saving, setSaving] = useState(false);
  const [ids] = useState(() => ({ id: randomUUID(), mutationId: randomUUID() }));
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const commit = (remove = false) => {
    if (!repo || !partition || lock.current) return;
    let count = 0;
    try { if (!remove) count = quantity(value); }
    catch (failure) { setError((failure as Error).message); return; }
    if (!remove && count > 100 && confirmation !== 'large') { setConfirmation('large'); return; }
    lock.current = true;
    setSaving(true);
    setError(null);
    let saved: LocalCheckin;
    try {
      saved = remove && record ? repo.delete(partition.id, record.id) : record ? repo.edit(partition.id, record.id, count) : repo.create(partition.id, { ...ids, quantity: count, occurredAt: new Date().toISOString(), timezone: deviceTimezone() });
    } catch {
      lock.current = false;
      setSaving(false);
      setError('Nothing was saved. Your draft is still here. Please try again.');
      return;
    }
    onSaved(saved, !record);
    confirmLocalCommit(repo);
  };
  let projected: string | null = null;
  try {
    if (repo && partition) projected = String(BigInt(repo.total(partition.id, record?.local_date ?? date)) - BigInt(record?.quantity ?? 0) + BigInt(quantity(value)));
  } catch { /* Invalid drafts are explained on save, without replacing the input. */ }
  return <BottomSheet visible title={record ? 'Edit check-in' : 'Log pushups'} onClose={close}>
    {record && <Copy variant="caption">Recorded {new Date(record.occurred_at).toLocaleString(undefined, { timeZone: record.recorded_timezone })} · {record.recorded_timezone}</Copy>}
    <QuantityInput value={value} disabled={saving} onChange={next => { setValue(next); setConfirmation(null); setError(null); }} />
    {projected !== null && <Copy>{projected} pushups {record && record.local_date !== date ? `on ${record.local_date}` : 'today'} after saving.</Copy>}
    {error && <Notice error>{error}</Notice>}
    {confirmation === 'large' ? <><Copy>{record ? 'Save' : 'Add'} {value.trim()} pushups?</Copy><Button label={record ? 'Confirm save' : 'Confirm add'} onPress={() => commit()} busy={saving} /><Button label="Keep editing" secondary onPress={() => setConfirmation(null)} disabled={saving} /></> : confirmation === 'delete' ? <><Copy>Delete this check-in? It will no longer count toward your total.</Copy><Button label="Confirm delete" onPress={() => commit(true)} busy={saving} /><Button label="Keep check-in" secondary onPress={() => setConfirmation(null)} disabled={saving} /></> : <>
      <Button testID="save-checkin" label={record ? 'Save changes' : 'Add pushups'} onPress={() => commit()} busy={saving} />
      {record && <Button label="Delete check-in" secondary onPress={() => setConfirmation('delete')} disabled={saving} />}
      <Button label="Cancel" secondary onPress={close} disabled={saving} />
    </>}
  </BottomSheet>;
}
