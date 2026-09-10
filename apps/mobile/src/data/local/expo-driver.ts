import { openDatabaseAsync } from 'expo-sqlite';
import type { SqlDriver } from './driver';

export async function openLocalDatabase(): Promise<SqlDriver> {
  const database = await openDatabaseAsync('100pushupclub.db');
  return {
    exec: sql => database.execSync(sql),
    run: (sql, ...parameters) => { database.runSync(sql, ...parameters); },
    all: (sql, ...parameters) => database.getAllSync(sql, ...parameters),
    transaction: work => {
      let result: ReturnType<typeof work>;
      database.withTransactionSync(() => { result = work(); });
      return result!;
    },
    close: () => database.closeSync(),
  };
}
