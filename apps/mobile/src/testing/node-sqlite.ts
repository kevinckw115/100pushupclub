// Host integration-test adapter only. Never import this module from app code.
import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver } from '../data/local/driver.ts';

export function openTestDatabase(filename: string): SqlDriver {
  const database = new DatabaseSync(filename);
  return {
    exec: sql => database.exec(sql),
    run: (sql, ...params) => { database.prepare(sql).run(...params); },
    all: <T>(sql: string, ...params: (string | number | null)[]) => database.prepare(sql).all(...params) as T[],
    transaction: work => {
      database.exec('BEGIN IMMEDIATE');
      try { const result = work(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    close: () => database.close(),
  };
}
