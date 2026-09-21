import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice } from '../src/components/ui';
import { useLocal } from '../src/services/local-context';
import { useAuth } from '../src/services/auth-context';
import { authEnvironment } from '../src/services/auth-client';
import { HttpSyncTransport } from '../src/data/sync/transport';
import { LocalExportSnapshot } from '../src/data/local/export';
import { makeExportFile } from '../src/services/export-file';
import { SyncFailure } from '../src/data/sync/protocol';
let exportRunning = false;
export default function Export() {
  const router = useRouter(), { repo, partition } = useLocal(), { connection } = useAuth();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), abort = useRef<AbortController | null>(null), focused = useRef(false);
  useFocusEffect(useCallback(() => { focused.current = true; const sub = AppState.addEventListener('change', state => { if (state !== 'active') abort.current?.abort(); }); return () => { focused.current = false; abort.current?.abort(); sub.remove(); }; }, []));
  const run = async (cloud: boolean) => {
    if (!repo || !partition || exportRunning) return; const identity = partition.id;
    exportRunning = true; setBusy(true); setMessage('Preparing your export…'); const controller = new AbortController(); abort.current = controller;
    let file: ReturnType<typeof makeExportFile> | undefined, snapshot: LocalExportSnapshot | undefined;
    const current = () => { if (!focused.current || controller.signal.aborted || repo.activePartition()?.id !== identity) throw new Error('Export cancelled.'); };
    try {
      file = makeExportFile(); let total = 0, first = true;
      const appendRows = (rows: unknown[]) => { for (const row of rows) { file!.append((first ? '' : ',\n') + JSON.stringify(row)); first = false; } total += rows.length; setMessage(`${total} records prepared…`); };
      if (cloud) {
        if (!connection || !authEnvironment.connected) throw new Error('Reconnect to export your saved cloud account.');
        const transport = new HttpSyncTransport(authEnvironment.url!, authEnvironment.key!, connection); let after: string | null = null, revision: string | null = null;
        for (;;) {
          current(); let page;
          try { page = await transport.exportAccount(after, revision, controller.signal); }
          catch (error) {
            if (!(error instanceof SyncFailure) || error.code !== 'RATE_LIMITED') throw error;
            setMessage(`${total} records prepared. Waiting for the server’s rate pause…`);
            await new Promise<void>((resolve, reject) => { const cancel = () => { clearTimeout(timer); reject(new Error('Export cancelled.')); }; const timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, Math.max(1000, error.retryAfterMs)); controller.signal.addEventListener('abort', cancel, { once: true }); if (controller.signal.aborted) cancel(); });
            continue;
          }
          current();
          if (revision === null) { revision = page.revision; file.append(JSON.stringify({ format: '100pushupclub-v1', scope: 'saved-cloud-account', exported_at: new Date().toISOString(), revision, profile: page.profile }).slice(0, -1) + ',"records":[\n'); }
          appendRows(page.records); after = page.next_id; if (after === null) break;
        }
      } else {
        snapshot = new LocalExportSnapshot(repo, identity);
        file.append(JSON.stringify({ format: '100pushupclub-v1', scope: partition.kind === 'guest' ? 'guest-on-this-device' : 'account-copy-on-this-device', exported_at: new Date().toISOString(), includes_unsynced: true }).slice(0, -1) + ',"records":[\n');
        let after = '';
        for (;;) { current(); const rows = snapshot.page(after); if (!rows.length) break; appendRows(rows.map(r => ({ ...r, deleted: r.deleted === 1 }))); after = rows[rows.length - 1].id; await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      current(); file.append('\n]}'); await file.present(); if (focused.current) setMessage(`${total} records prepared. Use your device’s download or sharing controls to keep the file.`);
    } catch (error) { if (focused.current) setMessage(error instanceof SyncFailure ? error.code === 'EXPORT_CHANGED' ? 'Your cloud records changed during export. Start again for a consistent copy.' : error.code === 'RATE_LIMITED' ? 'The server paused this export. Wait a minute, then start again.' : 'Could not export saved account data. Reconnect and try again.' : error instanceof Error ? error.message : 'Export could not be prepared.'); }
    finally { try { snapshot?.close(); } finally { try { file?.dispose(); } finally { exportRunning = false; if (focused.current) setBusy(false); } } }
  };
  return <AppScreen><Header /><Copy variant="title">Export your data</Copy><Copy>Exports contain your own records. They never include other members’ activity, authentication tokens or invitation codes.</Copy>
    <Copy>The local copy includes pending changes and sync states. The saved cloud copy includes accepted records and account preferences. These remain separate from guest history.</Copy>
    <Button label="Export this device’s records" disabled={!partition} busy={busy} onPress={() => { void run(false); }} />
    {partition?.kind === 'account' && <Button secondary label="Export saved cloud account" disabled={!connection} busy={busy} onPress={() => { void run(true); }} />}
    {busy && <Button secondary label="Cancel export" onPress={() => abort.current?.abort()} />}
    {message && <Notice>{message}</Notice>}<Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} />
  </AppScreen>;
}
