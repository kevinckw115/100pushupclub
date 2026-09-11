import type { LocalRepository, LocalCheckin } from './repository.ts';
import { uuid } from '../../domain/checkin.ts';
import { ownCheckin, SyncFailure } from '../sync/protocol.ts';
import type { OwnCheckin, CheckinMutation } from '../sync/protocol.ts';

export interface ImportJob {
  guest_partition: string; account_partition: string; source_id: string; destination_id: string;
  mutation_id: string; state: string; snapshot_json: string; remote_json: string | null;
  code: string | null; collision_attempts: number; cleaned: number;
}
export class ImportRepository {
  readonly local: LocalRepository; readonly account: string;
  constructor(local: LocalRepository, account: string) { this.local = local; this.account = account; }
  private active() { const p = this.local.activePartition(); if (p?.id !== this.account || p.kind !== 'account') throw new SyncFailure('STALE_SCOPE'); }
  available(): LocalCheckin[] {
    this.active();
    return this.local.db.all<LocalCheckin>(`SELECT c.* FROM local_checkins c JOIN local_partitions p ON p.id=c.partition_id
      WHERE p.kind='guest' AND c.deleted=0 AND NOT EXISTS(SELECT 1 FROM guest_imports i WHERE i.guest_partition=c.partition_id AND i.source_id=c.id AND i.account_partition=?)
      ORDER BY c.occurred_at,c.id LIMIT 50`, this.account);
  }
  jobs(state?: string): ImportJob[] {
    this.active(); return this.local.db.all<ImportJob>(`SELECT * FROM guest_imports WHERE account_partition=? ${state ? 'AND state=?' : ''} ORDER BY source_id LIMIT 50`, this.account, ...(state ? [state] : []));
  }
  job(id: string): ImportJob | null {
    this.active(); return this.local.db.all<ImportJob>('SELECT * FROM guest_imports WHERE account_partition=? AND destination_id=?', this.account, id)[0] ?? null;
  }
  counts(): Record<string, number> {
    this.active(); return Object.fromEntries(this.local.db.all<{ state: string; count: number }>('SELECT state,COUNT(*) count FROM guest_imports WHERE account_partition=? GROUP BY state', this.account).map(r => [r.state, r.count]));
  }
  private same(source: LocalCheckin, remote: OwnCheckin) {
    return !remote.deleted_at && remote.source === 'import' && remote.quantity === source.quantity && remote.occurred_at === source.occurred_at && remote.recorded_timezone === source.recorded_timezone && remote.local_date === source.local_date && remote.public_epoch === null && remote.public_region_id === null;
  }
  private update(job: ImportJob, state: string, code: string | null = null, remote: OwnCheckin | null = null) {
    this.local.db.run('UPDATE guest_imports SET state=?,code=?,remote_json=? WHERE account_partition=? AND source_id=? AND guest_partition=?', state, code, remote ? JSON.stringify(remote) : null, this.account, job.source_id, job.guest_partition);
  }
  start(selected: { partition: string; id: string }[]) {
    if (!selected.length || selected.length > 50) throw new Error('Choose between 1 and 50 guest check-ins.');
    this.local.db.transaction(() => {
      this.active();
      for (const item of selected) {
        const guest = this.local.db.all<{ kind: string }>('SELECT kind FROM local_partitions WHERE id=?', item.partition)[0];
        const source = this.local.get(item.partition, item.id);
        if (guest?.kind !== 'guest' || !source || source.deleted) throw new Error('Guest selection changed. Review it again.');
        if (this.local.db.all('SELECT 1 FROM guest_imports WHERE guest_partition=? AND account_partition=? AND source_id=?', item.partition, this.account, item.id).length) continue;
        const job: ImportJob = { guest_partition: item.partition, account_partition: this.account, source_id: item.id, destination_id: item.id, mutation_id: uuid(this.local.makeId()), state: 'pending', snapshot_json: JSON.stringify(source), remote_json: null, code: null, collision_attempts: 0, cleaned: 0 };
        this.local.db.run("INSERT INTO guest_imports(guest_partition,account_partition,source_id,destination_id,mutation_id,state,snapshot_json) VALUES(?,?,?,?,?,'pending',?)", job.guest_partition, this.account, job.source_id, job.destination_id, job.mutation_id, job.snapshot_json);
        this.queue(job);
      }
    });
  }
  private queue(job: ImportJob) {
    const source: LocalCheckin = JSON.parse(job.snapshot_json), db = this.local.db;
    if (db.all('SELECT 1 FROM outbox WHERE partition_id=? AND mutation_id=?', this.account, job.mutation_id).length) return;
    const existing = this.local.get(this.account, job.destination_id);
    if (existing) {
      const remote = existing.accepted_json ? ownCheckin(JSON.parse(existing.accepted_json)) : null;
      if (remote && this.same(source, remote)) this.update(job, 'acknowledged', null, remote);
      else this.update(job, 'conflict', 'ENTITY_EXISTS', remote);
      return;
    }
    db.run("INSERT INTO local_checkins(partition_id,id,quantity,occurred_at,recorded_timezone,local_date,source,state) VALUES(?,?,?,?,?,?,'import','pending')", this.account, job.destination_id, source.quantity, source.occurred_at, source.recorded_timezone, source.local_date);
    const request: CheckinMutation = { kind: 'create', mutation_id: job.mutation_id, checkin_id: job.destination_id, quantity: source.quantity, occurred_at: source.occurred_at, recorded_timezone: source.recorded_timezone, local_date: source.local_date, source: 'import', requested_public_epoch: null };
    db.run("INSERT INTO outbox(partition_id,mutation_id,entity_id,operation,intent_quantity,request_json) VALUES(?,?,?,'create',?,?)", this.account, job.mutation_id, job.destination_id, source.quantity, JSON.stringify(request));
  }
  resume() {
    this.local.db.transaction(() => { this.active(); for (const job of this.jobs('pending')) this.queue(job); });
  }
  resumePaused() {
    this.local.db.transaction(() => { this.active(); for (const job of this.jobs('paused')) { this.update(job, 'pending'); this.queue(job); } });
  }
  acknowledge(id: string, mutation: string, record: OwnCheckin) {
    const job = this.job(id);
    if (job && job.mutation_id === mutation && job.state === 'pending') {
      if (!this.same(JSON.parse(job.snapshot_json), record)) throw new SyncFailure('IMPORT_CONTENT_CHANGED');
      this.update(job, 'acknowledged', null, record);
    }
  }
  identical(id: string, record: OwnCheckin) { const job = this.job(id); return !!job && job.state === 'pending' && this.same(JSON.parse(job.snapshot_json), record); }
  fail(id: string, mutation: string, error: SyncFailure): boolean {
    const job = this.job(id);
    if (!job || job.mutation_id !== mutation || !['pending', 'conflict'].includes(job.state)) return false;
    if (job.state === 'pending' && error.code === 'NOT_FOUND_OR_FORBIDDEN' && error.status === 404 && job.collision_attempts < 3) { this.remap(job); return true; }
    this.update(job, 'conflict', error.code, error.record ?? null);
    this.local.db.run("UPDATE outbox SET status='conflict' WHERE partition_id=? AND mutation_id=?", this.account, mutation);
    this.local.db.run("UPDATE local_checkins SET state='conflict' WHERE partition_id=? AND id=?", this.account, id);
    return true;
  }
  private removeAttempt(job: ImportJob) {
    const db = this.local.db;
    const owned = db.all('SELECT 1 FROM outbox WHERE partition_id=? AND mutation_id=?', this.account, job.mutation_id).length;
    if (!owned) return; // Existing account activity was never replaced by this import.
    db.run('DELETE FROM sync_issues WHERE partition_id=? AND entity_id=?', this.account, job.destination_id);
    db.run('DELETE FROM outbox WHERE partition_id=? AND entity_id=?', this.account, job.destination_id);
    db.run('DELETE FROM local_checkins WHERE partition_id=? AND id=?', this.account, job.destination_id);
    if (job.remote_json) {
      const r = ownCheckin(JSON.parse(job.remote_json));
      db.run("INSERT INTO local_checkins(partition_id,id,quantity,occurred_at,recorded_timezone,local_date,source,deleted,accepted_json,server_version,server_revision,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,'acknowledged')", this.account, r.id, r.quantity, r.occurred_at, r.recorded_timezone, r.local_date, r.source, r.deleted_at ? 1 : 0, JSON.stringify(r), r.version, r.revision);
    }
  }
  private remap(job: ImportJob) {
    this.removeAttempt(job);
    const destination = uuid(this.local.makeId()), mutation = uuid(this.local.makeId());
    this.local.db.run("UPDATE guest_imports SET destination_id=?,mutation_id=?,state='pending',code=NULL,remote_json=NULL,collision_attempts=collision_attempts+1 WHERE account_partition=? AND guest_partition=? AND source_id=?", destination, mutation, this.account, job.guest_partition, job.source_id);
    this.queue({ ...job, destination_id: destination, mutation_id: mutation, state: 'pending', remote_json: null });
  }
  resolve(id: string, choice: 'separate' | 'keep' | 'retry') {
    this.local.db.transaction(() => {
      const job = this.job(id); if (!job || (job.state !== 'conflict' && !(job.state === 'paused' && choice === 'keep'))) throw new SyncFailure('LOCAL_STATE');
      if (choice === 'separate') this.remap(job);
      else if (choice === 'keep') { this.removeAttempt(job); this.update(job, 'cancelled'); }
      else {
        if (job.code === 'ENTITY_EXISTS' || job.code === 'NOT_FOUND_OR_FORBIDDEN') throw new SyncFailure('CHOICE_REQUIRED');
        this.update(job, 'pending');
        this.local.db.run("UPDATE outbox SET status='sending',next_retry_at=NULL WHERE partition_id=? AND mutation_id=?", this.account, job.mutation_id);
        this.local.db.run("UPDATE local_checkins SET state='pending' WHERE partition_id=? AND id=?", this.account, id);
      }
    });
  }
  cleanup(): number {
    return this.local.db.transaction(() => {
      this.active();
      const counts = this.counts(); if ((counts.pending ?? 0) + (counts.conflict ?? 0) + (counts.paused ?? 0)) throw new Error('Finish or cancel the selected imports before cleanup.');
      let removed = 0;
      const jobs = this.local.db.all<ImportJob>("SELECT * FROM guest_imports WHERE account_partition=? AND state='acknowledged' AND cleaned=0 ORDER BY source_id LIMIT 50", this.account);
      for (const job of jobs) {
        const source: LocalCheckin = JSON.parse(job.snapshot_json), current = this.local.get(job.guest_partition, job.source_id);
        const accountCopy = this.local.get(this.account, job.destination_id);
        if (!accountCopy?.accepted_json || accountCopy.deleted || !this.same(source, ownCheckin(JSON.parse(accountCopy.accepted_json)))) continue;
        // Retain guest edits made after the consent snapshot.
        if (current && !current.deleted && current.quantity === source.quantity && current.occurred_at === source.occurred_at && current.recorded_timezone === source.recorded_timezone) {
          this.local.db.run('UPDATE local_checkins SET deleted=1 WHERE partition_id=? AND id=?', job.guest_partition, job.source_id); removed++;
        }
        this.local.db.run('UPDATE guest_imports SET cleaned=1 WHERE account_partition=? AND guest_partition=? AND source_id=?', this.account, job.guest_partition, job.source_id);
      }
      return removed;
    });
  }
}
