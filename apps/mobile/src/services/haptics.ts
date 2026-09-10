import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LocalRepository } from '../data/local/repository';

export function confirmLocalCommit(repo: LocalRepository) {
  try {
    if (Platform.OS === 'web' || repo.preference('device', 'haptics') === 'off') return;
    void Haptics.selectionAsync().catch(() => undefined);
  } catch { /* Optional feedback must not invalidate an already committed save. */ }
}
