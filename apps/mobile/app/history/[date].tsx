import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AccessibilityInfo } from 'react-native';
import { AppScreen, Header, Copy, Button, Notice } from '../../src/components/ui';
import { useLocal, LoadingStorage } from '../../src/services/local-context';
import { calendarDate } from '../../src/domain/calendar';
import { CheckinList } from '../../src/features/history/CheckinList';
import { CheckinEditor } from '../../src/features/logging/CheckinEditor';
import type { LocalCheckin } from '../../src/data/local/repository';

export default function HistoryDay() {
  const parameters = useLocalSearchParams<{ date: string }>();
  const { repo, partition, refresh } = useLocal();
  const router = useRouter();
  const [editor, setEditor] = useState<LocalCheckin | null>(null);
  if (!repo || !partition) return <LoadingStorage />;
  let date: string;
  try { date = calendarDate(parameters.date); }
  catch { return <AppScreen><Notice error>This date is not available.</Notice><Button label="Back to history" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/you')} /></AppScreen>; }
  return <AppScreen><Header /><Copy variant="title">{date}</Copy><Copy>{repo.total(partition.id, date)} pushups</Copy>
    <CheckinList key={date} date={date} onEdit={setEditor} />
    <Button label="Back to history" secondary onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/you')} />
    {editor && <CheckinEditor record={editor} onClose={() => setEditor(null)} onSaved={record => { setEditor(null); refresh(); AccessibilityInfo.announceForAccessibility(record.deleted ? 'Check-in deleted.' : 'Check-in updated.'); }} />}
  </AppScreen>;
}
