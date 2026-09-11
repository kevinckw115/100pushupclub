import type { LocalRepository } from './repository.ts';
export interface LocalExportRow { id: string; quantity: number; occurred_at: string; recorded_timezone: string; local_date: string; source: string; deleted: number; state: string }
/** A connection-local SQLite snapshot; unrelated new logs can proceed during file writing. */
export class LocalExportSnapshot {
  readonly local: LocalRepository; readonly partition: string;
  constructor(local: LocalRepository, partition: string) {
    this.local = local; this.partition = partition;
    if (local.activePartition()?.id !== partition) throw new Error('Account changed.');
    local.db.transaction(() => {
      local.db.exec('CREATE TEMP TABLE export_snapshot(id TEXT PRIMARY KEY,quantity INTEGER,occurred_at TEXT,recorded_timezone TEXT,local_date TEXT,source TEXT,deleted INTEGER,state TEXT);');
      local.db.run('INSERT INTO temp.export_snapshot SELECT id,quantity,occurred_at,recorded_timezone,local_date,source,deleted,state FROM local_checkins WHERE partition_id=?', partition);
    });
  }
  page(after = '') { if (this.local.activePartition()?.id !== this.partition) throw new Error('Account changed.'); return this.local.db.all<LocalExportRow>('SELECT * FROM temp.export_snapshot WHERE id>? ORDER BY id LIMIT 500', after); }
  close() { this.local.db.exec('DROP TABLE IF EXISTS temp.export_snapshot'); }
}
