import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, TextInput } from 'react-native';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
import { LoadingStorage, useLocal } from '../src/services/local-context';
import { parseReminderTime } from '../src/domain/reminders';
import { readReminderSettings, refreshReminders, remindersSupported, requestReminderPermission } from '../src/services/reminders';
import { theme, typography } from '../src/theme/theme';
export default function Settings() {
  const router = useRouter();
  const { repo, refresh, reminderStatus } = useLocal();
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  if (!repo) return <LoadingStorage />;
  const preferences = readReminderSettings(repo);
  const time = draft ?? `${String(preferences.hour).padStart(2, '0')}:${String(preferences.minute).padStart(2, '0')}`;
  const haptics = repo.preference('device', 'haptics') !== 'off';
  const changeReminder = async (enabled: boolean, request = false) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setMessage(null);
    let committed = false;
    try {
      const parsed = parseReminderTime(time);
      if (request && !await requestReminderPermission()) { setMessage('Notifications are disabled in system settings. Tracking still works.'); return; }
      repo.setPreference('device', 'reminders', JSON.stringify({ ...parsed, enabled }));
      committed = true; refresh();
      const status = await refreshReminders(repo);
      setMessage(status === 'scheduled' ? 'Reminder scheduled on this phone.' : status === 'denied' ? 'Saved, but notifications are disabled in system settings.' : 'Reminder preference saved.');
    } catch (error) { setMessage(committed ? 'Preference saved, but scheduling failed. Try again when ready.' : error instanceof Error && error.message.startsWith('Use a time') ? error.message : 'Could not save this preference. Please try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <AppScreen><Header /><Copy variant="title">Settings</Copy><Copy>Your check-ins are saved privately on this phone.</Copy>
    <Section title="After a save"><Button secondary label={`Haptics: ${haptics ? 'on' : 'off'}`} onPress={() => {
      try { repo.setPreference('device', 'haptics', haptics ? 'off' : 'on'); refresh(); setMessage('Haptic preference saved.'); }
      catch { setMessage('Could not save the haptic preference.'); }
    }} /></Section>
    <Section title="A quiet reminder">
      <Copy>One reminder at your chosen local time. Off by default. Delivery depends on your phone’s notification settings.</Copy>
      <Copy>Time (24-hour HH:MM)</Copy>
      <TextInput accessibilityLabel="Reminder time" value={time} onChangeText={setDraft} autoCapitalize="none" style={{ ...typography('body'), minHeight: 52, padding: 12, borderWidth: 1, borderRadius: 12, borderColor: theme.colors.textSecondary }} />
      <Button secondary label="Save reminder time" onPress={() => void changeReminder(preferences.enabled)} busy={busy} />
      {remindersSupported ? <Button label={preferences.enabled ? 'Turn reminders off' : 'Enable reminders'} onPress={() => void changeReminder(!preferences.enabled, !preferences.enabled)} busy={busy} /> : <Notice>Reminders are available in the iPhone and Android app.</Notice>}
      {reminderStatus === 'denied' && <Button secondary label="Open notification settings" onPress={() => { void Linking.openSettings().catch(() => setMessage('Open your phone’s settings to allow notifications.')); }} />}
      {reminderStatus === 'failed' && <Notice error>Reminders could not be scheduled. Save the setting again to retry.</Notice>}
    </Section>
    {message && <Notice>{message}</Notice>}
    <Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/today')} />
  </AppScreen>;
}
