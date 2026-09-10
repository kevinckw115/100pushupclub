import { instant, localDate, quantity, uuid } from '../../domain/checkin.ts';
import { calendarDate, shiftDate } from '../../domain/calendar.ts';
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

  edit(partitionId: string, id: string, value: unknown): LocalCheckin {
    return this.change(partitionId, id, quantity(value));
  }

  delete(partitionId: string, id: string): LocalCheckin {
    return this.change(partitionId, id, null);
  }

  private change(partitionId: string, id: string, count: number | null): LocalCheckin {
    return this.db.transaction(() => {
      const partition = this.partition(partitionId);
      const record = this.get(partitionId, id);
      if (!record || record.deleted) throw new Error('This check-in is no longer available.');
      if (record.state === 'conflict' || record.state === 'rejected') throw new Error('Resolve this check-in’s sync issue before changing it.');
      if (partition.kind === 'account') {
        const last = this.db.all<{ mutation_id: string; operation: string; status: string; request_json: string | null }>(
          "SELECT mutation_id,operation,status,request_json FROM outbox WHERE partition_id=? AND entity_id=? AND status <> 'acknowledged' ORDER BY sequence DESC LIMIT 1", partitionId, id)[0];
        if (last?.status === 'pending' && last.operation === 'create') {
          if (count === null) this.db.run('DELETE FROM outbox WHERE partition_id=? AND mutation_id=?', partitionId, last.mutation_id);
          else this.db.run('UPDATE outbox SET intent_quantity=?,request_json=? WHERE partition_id=? AND mutation_id=?', count, JSON.stringify({ ...JSON.parse(last.request_json!), quantity: count }), partitionId, last.mutation_id);
        } else {
          const mutationId = uuid(this.makeId());
          const operation = count === null ? 'delete' : 'update';
          const request = last ? null : JSON.stringify({ kind: operation, mutation_id: mutationId, checkin_id: id, expected_version: record.server_version, ...(count === null ? {} : { quantity: count }) });
          this.db.run('INSERT INTO outbox(partition_id,mutation_id,entity_id,operation,intent_quantity,request_json,base_version,dependency_mutation) VALUES(?,?,?,?,?,?,?,?)',
            partitionId, mutationId, id, operation, count, request, last ? null : record.server_version, last?.mutation_id ?? null);
        }
      }
      this.db.run('UPDATE local_checkins SET quantity=?,deleted=?,state=? WHERE partition_id=? AND id=?', count ?? record.quantity, count === null ? 1 : 0, partition.kind === 'guest' ? 'local' : 'pending', partitionId, id);
      return this.get(partitionId, id)!;
    });
  }

  day(partitionId: string, date: string, before?: { time: string; id: string }): LocalCheckin[] {
    return this.db.all<LocalCheckin>(`SELECT * FROM local_checkins WHERE partition_id=? AND local_date=? AND deleted=0
      ${before ? 'AND (occurred_at < ? OR (occurred_at = ? AND id < ?))' : ''}
      ORDER BY occurred_at DESC,id DESC LIMIT 100`, partitionId, date, ...(before ? [before.time, before.time, before.id] : []));
  }

  total(partitionId: string, date: string): string {
    return this.db.all<{ total: string }>('SELECT CAST(COALESCE(SUM(quantity),0) AS TEXT) AS total FROM local_checkins WHERE partition_id=? AND local_date=? AND deleted=0', partitionId, date)[0].total;
  }

  history(partitionId: string, endingDate: string): { date: string; total: string }[] {
    calendarDate(endingDate);
    const start = shiftDate(endingDate, -29);
    const rows = this.db.all<{ date: string; total: string }>('SELECT local_date AS date, CAST(SUM(quantity) AS TEXT) AS total FROM local_checkins WHERE partition_id=? AND local_date BETWEEN ? AND ? AND deleted=0 GROUP BY local_date ORDER BY local_date DESC LIMIT 30', partitionId, start, endingDate);
    const totals = new Map(rows.map(row => [row.date, row.total]));
    return Array.from({ length: 30 }, (_, index) => { const date = shiftDate(endingDate, -index); return { date, total: totals.get(date) ?? '0' }; });
  }

  preference(scope: string, key: string): string | null {
    return this.db.all<{ value: string }>('SELECT value FROM preferences WHERE scope=? AND key=?', scope, key)[0]?.value ?? null;
  }

  setPreference(scope: string, key: string, value: string) {
    this.db.run('INSERT INTO preferences(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value', scope, key, value);
  }
}
