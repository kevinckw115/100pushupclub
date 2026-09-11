import { Platform } from 'react-native';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
export interface ExportFile { append(text: string): void; present(): Promise<void>; dispose(): void }
export function makeExportFile(): ExportFile {
  const filename = '100pushupclub-' + new Date().toISOString().slice(0, 10) + '-' + randomUUID().slice(0, 8) + '.json';
  if (Platform.OS === 'web') {
    const chunks: string[] = []; let bytes = 0, url: string | null = null;
    return { append: text => { bytes += new TextEncoder().encode(text).length; if (bytes > 100000000) throw new Error('This export exceeds the browser preview’s100MB memory limit. Export on your phone.'); chunks.push(text); },
      present: async () => { url = URL.createObjectURL(new Blob(chunks, { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); await new Promise(resolve => setTimeout(resolve, 1000)); },
      dispose: () => { if (url) URL.revokeObjectURL(url); chunks.length = 0; } };
  }
  const directory = new Directory(Paths.cache, 'private-exports'); directory.create({ idempotent: true });
  const file = new File(directory, filename); file.create(); let handle: ReturnType<File['open']> | null = file.open(FileMode.WriteOnly);
  return { append: text => { if (!handle) throw new Error('Export file is closed.'); handle.writeBytes(new TextEncoder().encode(text)); },
    present: async () => { handle?.close(); handle = null; if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.'); await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your 100pushupclub export', UTI: 'public.json' }); },
    dispose: () => { handle?.close(); handle = null; if (file.exists) file.delete(); } };
}
export function clearInterruptedExports() {
  if (Platform.OS === 'web') return;
  const directory = new Directory(Paths.cache, 'private-exports');
  if (directory.exists) for (const entry of directory.list()) if (entry instanceof File && /^100pushupclub-\d{4}-\d\d-\d\d-[a-f0-9]{8}\.json$/.test(entry.name)) entry.delete();
}
