import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, TextInput } from 'react-native';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
import { LoadingStorage, useLocal } from '../src/services/local-context';
import { parseReminderTime } from '../src/domain/reminders';
import { readReminderSettings, refreshReminders, remindersSupported, requestReminderPermission } from '../src/services/reminders';
import { theme, typography } from '../src/theme/theme';
import { useAuth } from '../src/services/auth-context';
import { useSync } from '../src/services/sync-context';
import { SyncNotice } from '../src/features/logging/SyncNotice';
export default function Settings() {
  const router = useRouter();
  const { repo, partition, refresh, reminderStatus } = useLocal();
  const auth = useAuth();
  const sync = useSync();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
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
    <Section title="Account">
      {partition?.kind !== 'account' ? <Button secondary label="Sign in or recover account" onPress={() => router.push('/auth')} /> : <>
        <SyncNotice />
        <Button secondary label="Import guest check-ins" onPress={() => router.push('/guest-import')} />
        <Button secondary label="Reconnect account" onPress={() => router.push('/auth')} />
        {confirmSignOut ? <>
          <Notice>{repo.unsynced(partition.id)} check-ins haven’t synced. Discarding removes this account’s local records from this phone. Guest check-ins remain.</Notice>
          <Button secondary label="Retry account connection" onPress={() => { if (auth.connection) sync.retry(); else void auth.recover().catch(() => setMessage('Could not reconnect.')); }} />
          <Button label={repo.unsynced(partition.id) ? 'Discard and sign out' : 'Sign out'} onPress={() => { void auth.signOut(repo.unsynced(partition.id) > 0).catch(() => setMessage('Sign-out cleanup failed. Please retry.')); }} />
          <Button secondary label="Keep my check-ins" onPress={() => setConfirmSignOut(false)} />
        </> : <Button secondary label="Sign out on this phone" onPress={() => {
          if (repo.unsynced(partition.id)) setConfirmSignOut(true);
          else void auth.signOut(false).catch(() => setMessage('Sign-out cleanup failed. Please retry.'));
        }} />}
      </>}
      {auth.message && <Notice>{auth.message}</Notice>}
    </Section>
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
