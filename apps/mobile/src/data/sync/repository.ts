import type { LocalRepository, LocalCheckin } from '../local/repository.ts';
import { instant, localDate, quantity, uuid } from '../../domain/checkin.ts';
import { ownCheckin, SyncFailure } from './protocol.ts';
import type { CheckinMutation, OwnCheckin, MutationAccepted, PullPage } from './protocol.ts';
import { ImportRepository } from '../local/imports.ts';
import { ProfileRepository } from '../local/profile.ts';
import { SafetyRepository } from '../local/safety.ts';
import { CircleRepository } from '../local/circles.ts';

export interface QueuedMutation {
  sequence: number; partition_id: string; mutation_id: string; entity_id: string;
  operation: 'create' | 'update' | 'delete'; intent_quantity: number | null;
  request_json: string | null; base_version: number | null; dependency_mutation: string | null;
  status: 'pending' | 'sending' | 'acknowledged' | 'conflict' | 'rejected';
  attempts: number; next_retry_at: string | null; acknowledged_version: number | null;
}
export interface SyncIssue { entity_id: string; mutation_id: string; code: string; current_record: string | null }

export class SyncRepository {
  readonly circles: CircleRepository;
  readonly local: LocalRepository; readonly partitionId: string; readonly imports: ImportRepository; readonly profile: ProfileRepository; readonly safety: SafetyRepository;
  constructor(local: LocalRepository, partitionId: string) { this.local = local; this.partitionId = partitionId; this.imports = new ImportRepository(local, partitionId); this.profile = new ProfileRepository(local, partitionId); this.safety = new SafetyRepository(local, partitionId); this.circles = new CircleRepository(local, partitionId); }
  private active() {
    const active = this.local.activePartition();
    if (active?.id !== this.partitionId || active.kind !== 'account') throw new SyncFailure('STALE_SCOPE');
  }
  cursor(): string {
    this.active();
    return this.local.db.all<{ revision: string }>('SELECT revision FROM sync_cursors WHERE partition_id=?', this.partitionId)[0]?.revision ?? '0';
  }
  issues(): SyncIssue[] {
    this.active(); return this.local.db.all<SyncIssue>(`SELECT entity_id,mutation_id,code,current_record FROM sync_issues WHERE partition_id=?
      UNION ALL SELECT destination_id,mutation_id,code,remote_json FROM guest_imports WHERE account_partition=? AND state='conflict' ORDER BY entity_id LIMIT 100`, this.partitionId, this.partitionId);
  }
  beginNext(now: string): QueuedMutation | null {
    return this.local.db.transaction(() => {
      this.active(); const db = this.local.db;
      const row = db.all<QueuedMutation>(`SELECT o.* FROM outbox o WHERE o.partition_id=? AND o.status IN ('pending','sending')
        AND (o.next_retry_at IS NULL OR o.next_retry_at<=?)
        AND NOT EXISTS(SELECT 1 FROM sync_issues i WHERE i.partition_id=o.partition_id AND i.entity_id=o.entity_id)
        AND (o.dependency_mutation IS NULL OR EXISTS(SELECT 1 FROM outbox d WHERE d.partition_id=o.partition_id AND d.mutation_id=o.dependency_mutation AND d.status='acknowledged'))
        ORDER BY o.sequence LIMIT 1`, this.partitionId, now)[0];
      if (!row) return null;
      if (!row.request_json) {
        if (row.status !== 'pending' || row.operation === 'create') throw new SyncFailure('LOCAL_STATE');
        const dependency = row.dependency_mutation ? db.all<{ acknowledged_version: number }>('SELECT acknowledged_version FROM outbox WHERE partition_id=? AND mutation_id=?', this.partitionId, row.dependency_mutation)[0] : undefined;
        const version = row.dependency_mutation ? dependency?.acknowledged_version : this.local.get(this.partitionId, row.entity_id)?.server_version;
        if (!version) throw new SyncFailure('LOCAL_STATE');
        row.request_json = JSON.stringify({ kind: row.operation, mutation_id: row.mutation_id, checkin_id: row.entity_id, expected_version: version, ...(row.operation === 'update' ? { quantity: row.intent_quantity } : {}) });
        db.run('UPDATE outbox SET request_json=?,base_version=? WHERE partition_id=? AND mutation_id=?', row.request_json, version, this.partitionId, row.mutation_id);
      }
      db.run("UPDATE outbox SET status='sending',attempts=attempts+1,next_retry_at=NULL WHERE partition_id=? AND mutation_id=?", this.partitionId, row.mutation_id);
      return { ...row, attempts: row.attempts + 1, status: 'sending' };
    });
  }
  nextRetry(): string | null {
    return this.local.db.all<{ value: string | null }>("SELECT MIN(next_retry_at) value FROM outbox WHERE partition_id=? AND status IN ('pending','sending')", this.partitionId)[0].value;
  }
  adjustClock(now: string) {
    this.active();
    this.local.db.run(`UPDATE outbox SET next_retry_at=strftime('%Y-%m-%dT%H:%M:%fZ',?, '+'||(retry_delay_ms/1000.0)||' seconds')
      WHERE partition_id=? AND status IN ('pending','sending') AND next_retry_at IS NOT NULL
      AND (julianday(next_retry_at)-julianday(?))*86400000>retry_delay_ms+1000`, now, this.partitionId, now);
  }
  defer(mutationId: string, until: string, delay: number) {
    this.active(); this.local.db.run('UPDATE outbox SET next_retry_at=?,retry_delay_ms=? WHERE partition_id=? AND mutation_id=?', until, Math.ceil(delay), this.partitionId, mutationId);
  }
  clearRetry() { this.active(); this.local.db.run("UPDATE outbox SET next_retry_at=NULL WHERE partition_id=? AND status IN ('pending','sending')", this.partitionId); }

  private snapshot(record: OwnCheckin) {
    record = ownCheckin(record);
    const db = this.local.db, current = this.local.get(this.partitionId, record.id), serialized = JSON.stringify(record);
    if (!current) {
      db.run(`INSERT INTO local_checkins(partition_id,id,quantity,occurred_at,recorded_timezone,local_date,source,deleted,accepted_json,server_version,server_revision,state)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'acknowledged')`, this.partitionId, record.id, record.quantity, record.occurred_at, record.recorded_timezone, record.local_date, record.source, record.deleted_at ? 1 : 0, serialized, record.version, record.revision);
      return;
    }
    if (current.occurred_at !== record.occurred_at || current.recorded_timezone !== record.recorded_timezone || current.local_date !== record.local_date || current.source !== record.source) throw new SyncFailure('IDENTITY_CONFLICT');
    if (record.version < current.server_version) return;
    if (record.version === current.server_version && current.accepted_json && JSON.stringify(ownCheckin(JSON.parse(current.accepted_json))) !== serialized) throw new SyncFailure('PROTOCOL');
    db.run('UPDATE local_checkins SET accepted_json=?,server_version=?,server_revision=? WHERE partition_id=? AND id=?', serialized, record.version, record.revision, this.partitionId, record.id);
  }
  private project(id: string) {
    const db = this.local.db, current = this.local.get(this.partitionId, id);
    if (!current) throw new SyncFailure('LOCAL_STATE');
    const accepted = current.accepted_json ? ownCheckin(JSON.parse(current.accepted_json)) : null;
    const last = db.all<QueuedMutation>("SELECT * FROM outbox WHERE partition_id=? AND entity_id=? AND status<>'acknowledged' ORDER BY sequence DESC LIMIT 1", this.partitionId, id)[0];
    const issue = db.all<{ code: string }>('SELECT code FROM sync_issues WHERE partition_id=? AND entity_id=?', this.partitionId, id)[0];
    const amount = last ? db.all<{ intent_quantity: number }>("SELECT intent_quantity FROM outbox WHERE partition_id=? AND entity_id=? AND status<>'acknowledged' AND intent_quantity IS NOT NULL ORDER BY sequence DESC LIMIT 1", this.partitionId, id)[0]?.intent_quantity : undefined;
    const count = amount ?? accepted?.quantity ?? current.quantity;
    const deleted = last ? last.operation === 'delete' : accepted ? accepted.deleted_at !== null : !!current.deleted;
    const state = issue ? (['VERSION_CONFLICT', 'ENTITY_EXISTS'].includes(issue.code) ? 'conflict' : 'rejected') : last ? 'pending' : accepted ? 'acknowledged' : 'local';
    db.run('UPDATE local_checkins SET quantity=?,deleted=?,state=? WHERE partition_id=? AND id=?', count, deleted ? 1 : 0, state, this.partitionId, id);
  }
  acknowledge(row: QueuedMutation, result: MutationAccepted) {
    this.local.db.transaction(() => {
      this.active(); const db = this.local.db;
      if (!db.all('SELECT 1 FROM outbox WHERE partition_id=? AND mutation_id=?', this.partitionId, row.mutation_id).length) return;
      this.snapshot(result.record);
      this.imports.acknowledge(row.entity_id, row.mutation_id, result.record);
      db.run("UPDATE outbox SET status='acknowledged',acknowledged_version=?,next_retry_at=NULL WHERE partition_id=? AND mutation_id=?", result.record.version, this.partitionId, row.mutation_id);
      this.project(row.entity_id);
    });
  }
  applyPage(after: string, page: PullPage): boolean {
    return this.local.db.transaction(() => {
      this.active(); if (this.cursor() !== after) throw new SyncFailure('STALE_CURSOR');
      for (const record of page.changes) {
        const local = this.local.get(this.partitionId, record.id);
        if (local && local.server_version === 0 && (local.occurred_at !== record.occurred_at || local.recorded_timezone !== record.recorded_timezone || local.source !== record.source)) {
          const pending = this.local.db.all<QueuedMutation>("SELECT * FROM outbox WHERE partition_id=? AND entity_id=? AND operation='create' AND status<>'acknowledged' ORDER BY sequence LIMIT 1", this.partitionId, record.id)[0];
          if (!pending) throw new SyncFailure('IDENTITY_CONFLICT');
          this.writeIssue(pending, new SyncFailure('ENTITY_EXISTS', { status: 409, record }));
        } else { this.snapshot(record); this.project(record.id); }
      }
      this.local.db.run('INSERT INTO sync_cursors(partition_id,revision) VALUES(?,?) ON CONFLICT(partition_id) DO UPDATE SET revision=excluded.revision', this.partitionId, page.next_revision);
      return page.next_revision !== after;
    });
  }
  fail(row: QueuedMutation, failure: SyncFailure) {
    if (failure.code === 'ENTITY_EXISTS' && failure.record && this.imports.identical(row.entity_id, failure.record)) {
      this.acknowledge(row, { request_id: row.mutation_id, record: failure.record, revision: failure.record.revision, effective_public: false });
      return;
    }
    this.local.db.transaction(() => this.writeIssue(row, failure));
  }
  private writeIssue(row: QueuedMutation, failure: SyncFailure) {
      this.active(); const conflict = ['VERSION_CONFLICT', 'ENTITY_EXISTS'].includes(failure.code);
      if (failure.record?.id !== undefined && failure.record.id !== row.entity_id) throw new SyncFailure('PROTOCOL');
      if (this.imports.fail(row.entity_id, row.mutation_id, failure)) return;
      if (failure.record && failure.code === 'VERSION_CONFLICT') this.snapshot(failure.record);
      this.local.db.run('UPDATE outbox SET status=? WHERE partition_id=? AND mutation_id=?', conflict ? 'conflict' : 'rejected', this.partitionId, row.mutation_id);
      this.local.db.run('INSERT INTO sync_issues(partition_id,entity_id,mutation_id,code,current_record) VALUES(?,?,?,?,?) ON CONFLICT(partition_id,entity_id) DO UPDATE SET mutation_id=excluded.mutation_id,code=excluded.code,current_record=excluded.current_record', this.partitionId, row.entity_id, row.mutation_id, failure.code, failure.record ? JSON.stringify(failure.record) : null);
      this.project(row.entity_id);
  }
  private issue(id: string): { local: LocalCheckin; remote: OwnCheckin | null; code: string } {
    this.active(); const local = this.local.get(this.partitionId, id), issue = this.local.db.all<SyncIssue>('SELECT * FROM sync_issues WHERE partition_id=? AND entity_id=?', this.partitionId, id)[0];
    if (!local || !issue) throw new SyncFailure('LOCAL_STATE');
    let remote = issue.current_record ? ownCheckin(JSON.parse(issue.current_record)) : null;
    const accepted = local.accepted_json ? ownCheckin(JSON.parse(local.accepted_json)) : null;
    if (accepted && (!remote || accepted.version > remote.version)) remote = accepted;
    return { local, remote, code: issue.code };
  }
  details(id: string) { return this.issue(id); }
  retryIssue(id: string) {
    this.local.db.transaction(() => {
      const { code } = this.issue(id);
      if (['VERSION_CONFLICT', 'ENTITY_EXISTS'].includes(code)) throw new SyncFailure('CHOICE_REQUIRED');
      this.local.db.run('DELETE FROM sync_issues WHERE partition_id=? AND entity_id=?', this.partitionId, id);
      this.local.db.run("UPDATE outbox SET status='sending',next_retry_at=NULL WHERE partition_id=? AND entity_id=? AND status IN ('rejected','conflict')", this.partitionId, id);
      this.project(id);
    });
  }
  private clearIssue(id: string) {
    this.local.db.run('DELETE FROM sync_issues WHERE partition_id=? AND entity_id=?', this.partitionId, id);
    this.local.db.run("DELETE FROM outbox WHERE partition_id=? AND entity_id=? AND status<>'acknowledged'", this.partitionId, id);
  }
  useAccount(id: string) {
    this.local.db.transaction(() => {
      const { remote } = this.issue(id); this.clearIssue(id);
      if (remote) {
        // An explicit owner collision decision may replace the cancelled local identity.
        const local = this.local.get(this.partitionId, id)!;
        if (local.occurred_at !== remote.occurred_at || local.recorded_timezone !== remote.recorded_timezone || local.source !== remote.source) {
          this.local.db.run('DELETE FROM outbox WHERE partition_id=? AND entity_id=?', this.partitionId, id);
          this.local.db.run('DELETE FROM local_checkins WHERE partition_id=? AND id=?', this.partitionId, id);
        }
        this.snapshot(remote); this.project(id);
      } else this.local.db.run("UPDATE local_checkins SET deleted=1,state='local' WHERE partition_id=? AND id=?", this.partitionId, id);
    });
  }
  applyMine(id: string, value: unknown, remove = false) {
    const count = quantity(value);
    this.local.db.transaction(() => {
      const { local, remote, code } = this.issue(id);
      if (!remote || remote.deleted_at || code === 'ENTITY_EXISTS') throw new SyncFailure('REPLACEMENT_REQUIRED');
      this.clearIssue(id); this.snapshot(remote);
      const mutationId = uuid(this.local.makeId()), operation = remove ? 'delete' : 'update';
      const request: CheckinMutation = remove ? { kind: 'delete', mutation_id: mutationId, checkin_id: id, expected_version: remote.version } : { kind: 'update', mutation_id: mutationId, checkin_id: id, expected_version: remote.version, quantity: count };
      this.local.db.run('INSERT INTO outbox(partition_id,mutation_id,entity_id,operation,intent_quantity,request_json,base_version) VALUES(?,?,?,?,?,?,?)', this.partitionId, mutationId, id, operation, remove ? null : count, JSON.stringify(request), remote.version);
      this.local.db.run("UPDATE local_checkins SET quantity=?,deleted=?,state='pending' WHERE partition_id=? AND id=?", remove ? local.quantity : count, remove ? 1 : 0, this.partitionId, id);
    });
  }
  replacePrivately(id: string, value: unknown, now: string, timezone: string): string {
    const count = quantity(value), time = instant(now), date = localDate(time, timezone), nextId = uuid(this.local.makeId()), mutationId = uuid(this.local.makeId());
    this.local.db.transaction(() => {
      const { remote, code } = this.issue(id);
      if (remote && !remote.deleted_at && code !== 'ENTITY_EXISTS') throw new SyncFailure('REPLACEMENT_NOT_NEEDED');
      this.clearIssue(id);
      if (remote && remote.id === id) {
        // Keep the owner snapshot under its original ID; replacement has a new ID.
        this.local.db.run('DELETE FROM outbox WHERE partition_id=? AND entity_id=?', this.partitionId, id);
        this.local.db.run('DELETE FROM local_checkins WHERE partition_id=? AND id=?', this.partitionId, id);
        this.snapshot(remote);
      } else this.local.db.run("UPDATE local_checkins SET deleted=1,state='local' WHERE partition_id=? AND id=?", this.partitionId, id);
      this.local.db.run("INSERT INTO local_checkins(partition_id,id,quantity,occurred_at,recorded_timezone,local_date,source,state) VALUES(?,?,?,?,?,?,'native','pending')", this.partitionId, nextId, count, time, timezone, date);
      const request: CheckinMutation = { kind: 'create', mutation_id: mutationId, checkin_id: nextId, quantity: count, occurred_at: time, recorded_timezone: timezone, local_date: date, source: 'native', requested_public_epoch: null };
      this.local.db.run("INSERT INTO outbox(partition_id,mutation_id,entity_id,operation,intent_quantity,request_json) VALUES(?,?,?,'create',?,?)", this.partitionId, mutationId, nextId, count, JSON.stringify(request));
    });
    return nextId;
  }
}
