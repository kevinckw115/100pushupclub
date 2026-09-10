import { instant, localDate, quantity, uuid } from '../../domain/checkin.ts';
import type { SqlDriver } from './driver.ts';

export interface LocalCheckin {
  partition_id: string; id: string; quantity: number; occurred_at: string;
  recorded_timezone: string; local_date: string; source: 'native' | 'import';
  deleted: number; accepted_json: string | null; server_version: number;
  server_revision: string; state: 'local' | 'pending' | 'acknowledged' | 'conflict' | 'rejected';
}
export interface Partition { id: string; kind: 'guest' | 'account'; active: number }

export class LocalRepository {
  readonly db: SqlDriver;
  readonly makeId: () => string;
  constructor(db: SqlDriver, makeId: () => string) { this.db = db; this.makeId = makeId; }

  activePartition(): Partition | null {
    return this.db.all<Partition>('SELECT id,kind,active FROM local_partitions WHERE active=1')[0] ?? null;
  }

  startGuest(now: string): Partition {
    return this.db.transaction(() => {
      const guest = this.db.all<Partition>("SELECT id,kind,active FROM local_partitions WHERE kind='guest' ORDER BY created_at LIMIT 1")[0];
      this.db.run('UPDATE local_partitions SET active=0 WHERE active=1');
      if (guest) this.db.run('UPDATE local_partitions SET active=1 WHERE id=?', guest.id);
      else this.db.run("INSERT INTO local_partitions(id,kind,active,created_at) VALUES(?,'guest',1,?)", uuid(this.makeId()), instant(now));
      return this.activePartition()!;
    });
  }

  private partition(id: string): Partition {
    const partition = this.db.all<Partition>('SELECT id,kind,active FROM local_partitions WHERE id=?', id)[0];
    if (!partition) throw new Error('Local partition is unavailable.');
    return partition;
  }

  create(partitionId: string, input: { id: string; mutationId: string; quantity: unknown; occurredAt: string; timezone: string; publicEpoch?: string | null }): LocalCheckin {
    const id = uuid(input.id), mutationId = uuid(input.mutationId), count = quantity(input.quantity);
    const occurredAt = instant(input.occurredAt), date = localDate(occurredAt, input.timezone);
    if (input.publicEpoch != null && !/^\d+$/.test(input.publicEpoch)) throw new Error('Invalid consent epoch.');
    return this.db.transaction(() => {
      const partition = this.partition(partitionId);
      this.db.run(`INSERT INTO local_checkins(partition_id,id,quantity,occurred_at,recorded_timezone,local_date,source,state) VALUES(?,?,?,?,?,?,'native',?)`,
        partition.id, id, count, occurredAt, input.timezone, date, partition.kind === 'guest' ? 'local' : 'pending');
      if (partition.kind === 'account') {
        const request = { kind: 'create', mutation_id: mutationId, checkin_id: id, quantity: count, occurred_at: occurredAt, recorded_timezone: input.timezone, local_date: date, source: 'native', requested_public_epoch: input.publicEpoch ?? null };
        this.db.run("INSERT INTO outbox(partition_id,mutation_id,entity_id,operation,intent_quantity,request_json) VALUES(?,?,?,'create',?,?)", partition.id, mutationId, id, count, JSON.stringify(request));
      }
      return this.get(partitionId, id)!;
    });
  }

  get(partitionId: string, id: string): LocalCheckin | null {
    return this.db.all<LocalCheckin>('SELECT * FROM local_checkins WHERE partition_id=? AND id=?', partitionId, id)[0] ?? null;
  }

  day(partitionId: string, date: string, before?: { time: string; id: string }): LocalCheckin[] {
    return this.db.all<LocalCheckin>(`SELECT * FROM local_checkins WHERE partition_id=? AND local_date=? AND deleted=0
      ${before ? 'AND (occurred_at < ? OR (occurred_at = ? AND id < ?))' : ''}
      ORDER BY occurred_at DESC,id DESC LIMIT 100`, partitionId, date, ...(before ? [before.time, before.time, before.id] : []));
  }

  total(partitionId: string, date: string): string {
    return this.db.all<{ total: string }>('SELECT CAST(COALESCE(SUM(quantity),0) AS TEXT) AS total FROM local_checkins WHERE partition_id=? AND local_date=? AND deleted=0', partitionId, date)[0].total;
  }

  preference(scope: string, key: string): string | null {
    return this.db.all<{ value: string }>('SELECT value FROM preferences WHERE scope=? AND key=?', scope, key)[0]?.value ?? null;
  }

  setPreference(scope: string, key: string, value: string) {
    this.db.run('INSERT INTO preferences(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value', scope, key, value);
  }
}
