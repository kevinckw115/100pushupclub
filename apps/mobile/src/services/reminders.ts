import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { reconcileReminders } from '../domain/reminders';
import type { ReminderAdapter, ReminderSettings } from '../domain/reminders';
import type { LocalRepository } from '../data/local/repository';
import { localDate } from '../domain/checkin';

export const remindersSupported = Platform.OS !== 'web';
if (remindersSupported) Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
export function readReminderSettings(repo: LocalRepository): ReminderSettings {
  const raw = repo.preference('device', 'reminders');
  return raw ? JSON.parse(raw) : { enabled: false, hour: 18, minute: 0 };
}
async function prepareChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('daily-reminders', { name: 'Daily reminder', importance: Notifications.AndroidImportance.DEFAULT, sound: null, enableVibrate: false });
}
export async function requestReminderPermission() {
  if (!remindersSupported) return false;
  await prepareChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  return (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } })).granted;
}

const adapter: ReminderAdapter = {
  permission: async () => (await Notifications.getPermissionsAsync()).granted,
  list: async () => (await Notifications.getAllScheduledNotificationsAsync()).filter(request => request.content.data?.kind === 'pushupclub-daily').map(request => ({ id: request.identifier, at: String(request.content.data?.at) })),
  cancel: id => Notifications.cancelScheduledNotificationAsync(id),
  schedule: async reminder => {
    await prepareChannel();
    await Notifications.scheduleNotificationAsync({ identifier: reminder.id, content: { title: '100pushupclub', body: "A few pushups when you're ready.", data: { kind: 'pushupclub-daily', at: reminder.at }, sound: false }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.at), channelId: 'daily-reminders' } });
  },
};

let chain: Promise<unknown> = Promise.resolve();
export function refreshReminders(repo: LocalRepository): Promise<string> {
  if (!remindersSupported) return Promise.resolve('unsupported');
  const work = chain.catch(() => undefined).then(async () => {
    const settings = readReminderSettings(repo), partition = repo.activePartition();
    const now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const goal = partition ? BigInt(repo.total(partition.id, localDate(now.toISOString(), timezone))) >= 100n : false;
    return reconcileReminders(adapter, settings, now, timezone, goal);
  });
  chain = work;
  return work;
}
