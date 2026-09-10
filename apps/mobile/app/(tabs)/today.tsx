import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { AppScreen, Header, Copy, ProgressRing, Notice, Button } from '../../src/components/ui';
import { useLocal } from '../../src/services/local-context';
import { CheckinEditor } from '../../src/features/logging/CheckinEditor';
import type { LocalCheckin } from '../../src/data/local/repository';
import { theme } from '../../src/theme/theme';
import { CheckinList } from '../../src/features/history/CheckinList';

export default function Today() {
  const { repo, partition, date, refresh } = useLocal();
  const router = useRouter();
  const [editor, setEditor] = useState<LocalCheckin | 'new' | null>(null);
  const [toast, setToast] = useState<{ message: string; undoId?: string } | null>(null);
  const [undoError, setUndoError] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), theme.motion.undoMs);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!repo || !partition) return null;
  const total = repo.total(partition.id, date);
  const remaining = BigInt(total) < 100n ? 100n - BigInt(total) : 0n;
  const saved = (record: LocalCheckin, created: boolean) => {
    const message = record.deleted ? 'Check-in deleted.' : created ? `${record.quantity} added.` : 'Check-in updated.';
    setEditor(null); refresh(); setUndoError(false);
    setToast({ message, undoId: created ? record.id : undefined });
    AccessibilityInfo.announceForAccessibility(message);
  };
  const undo = () => {
    if (!toast?.undoId) return;
    try { repo.delete(partition.id, toast.undoId); refresh(); setToast(null); AccessibilityInfo.announceForAccessibility('Check-in undone.'); }
    catch { setUndoError(true); }
  };
  return <AppScreen><Header onSettings={() => router.push('/settings')} />
    <Copy variant="caption" style={{ textAlign: 'center', textTransform: 'uppercase' }}>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</Copy>
    <Copy variant="headline" style={{ textAlign: 'center' }}>A little at a time.</Copy>
    <ProgressRing total={total} />
    <Copy style={{ textAlign: 'center' }}>{remaining > 0n ? `${remaining} to go. Take your time.` : '100 today. Nicely done.'}</Copy>
    <Button label="Log pushups" onPress={() => setEditor('new')} />
    {toast && <Notice>{toast.message}</Notice>}
    {toast?.undoId && <Button label="Undo" secondary onPress={undo} />}
    {undoError && <Notice error>Could not undo. Open the check-in to try deleting it again.</Notice>}
    <CheckinList key={date} date={date} onEdit={setEditor} />
    <Notice>{partition.kind === 'guest' ? 'Saved on this phone. Your check-ins are private.' : 'Your personal check-ins'}</Notice>
    {editor && <CheckinEditor record={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={saved} />}
  </AppScreen>;
}
