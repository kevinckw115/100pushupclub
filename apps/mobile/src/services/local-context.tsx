import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { openLocalDatabase } from '../data/local/expo-driver';
import { migrate } from '../data/local/migrations';
import { LocalRepository } from '../data/local/repository';
import type { Partition } from '../data/local/repository';
import { localDate } from '../domain/checkin';
import { watchDay } from '../domain/calendar';
import { refreshReminders } from './reminders';
import { AppScreen, Header, Notice } from '../components/ui';

export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const currentDate = () => localDate(new Date().toISOString(), deviceTimezone());
type LocalState = { repo: LocalRepository | null; ready: boolean; error: string | null; partition: Partition | null; revision: number; date: string; refresh: () => void; reminderStatus: string };
const Context = createContext<LocalState | null>(null);

export function LocalProvider({ children }: PropsWithChildren) {
  const [repo, setRepo] = useState<LocalRepository | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partition, setPartition] = useState<Partition | null>(null);
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(currentDate);
  const [reminderStatus, setReminderStatus] = useState('off');
  useEffect(() => {
    let database: Awaited<ReturnType<typeof openLocalDatabase>> | undefined;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        database = await openLocalDatabase();
        if (!active) { database.close(); return; }
        migrate(database);
        const repository = new LocalRepository(database, randomUUID);
        setPartition(repository.activePartition());
        setRepo(repository);
      } catch (error) {
        console.warn('Local storage initialization failed:', error instanceof Error && error.message.includes('Sync operation timeout') ? 'SQLITE_WORKER_TIMEOUT' : 'SQLITE_OPEN_FAILED');
        setError('Storage could not be opened. Your records have not been deleted. Close the app and try again.');
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); database?.close(); };
  }, []);
  const refresh = useCallback(() => {
    setPartition(repo?.activePartition() ?? null);
    setDate(currentDate());
    setRevision(previous => previous + 1);
  }, [repo]);
  useEffect(() => {
    const start = () => watchDay({ now: () => new Date(), timezone: deviceTimezone, onChange: refresh, schedule: (callback, delay) => setTimeout(callback, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) });
    let stop = AppState.currentState === 'active' ? start() : undefined;
    const subscription = AppState.addEventListener('change', state => {
      stop?.(); stop = undefined;
      if (state === 'active') { refresh(); stop = start(); }
    });
    return () => { stop?.(); subscription.remove(); };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    if (repo) refreshReminders(repo).then(status => { if (active) setReminderStatus(status); }, () => { if (active) setReminderStatus('failed'); });
    return () => { active = false; };
  }, [repo, revision]);
  return <Context.Provider value={{ repo, ready: repo !== null, error, partition, revision, date, refresh, reminderStatus }}>{children}</Context.Provider>;
}

export function useLocal() {
  const context = useContext(Context);
  if (!context) throw new Error('Local storage provider is missing.');
  return context;
}

export function LoadingStorage() {
  const { error } = useLocal();
  return <AppScreen><Header /><Notice error={!!error}>{error ?? 'Opening your check-ins…'}</Notice></AppScreen>;
}
