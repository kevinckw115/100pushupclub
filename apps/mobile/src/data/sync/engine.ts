import { SyncFailure } from './protocol.ts';
import type { CheckinMutation } from './protocol.ts';
import type { SyncRepository, QueuedMutation } from './repository.ts';
import type { SyncTransport } from './transport.ts';

export type SyncStatus = { state: 'waiting' | 'syncing' | 'synced' | 'offline' | 'retrying' | 'blocked' | 'issues'; code?: string };
export interface SyncClock { now(): number; random(): number; schedule(run: () => void, delay: number): unknown; cancel(handle: unknown): void }
const defaultClock: SyncClock = { now: Date.now, random: Math.random, schedule: (run, delay) => setTimeout(run, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export class SyncEngine {
  readonly repo: SyncRepository; readonly transport: SyncTransport; readonly valid: () => boolean;
  private readonly clock: SyncClock; private readonly changed: () => void; private readonly report: (status: SyncStatus) => void;
  private alive = true; private online = true; private foreground = true;
  private running: Promise<void> | null = null; private requested = false;
  private controller = new AbortController(); private timer: unknown;
  private notBefore = 0; private failures = 0; private lastCode = ''; private lastDelay = 0;
  private blocked = false;
  constructor(options: { repo: SyncRepository; transport: SyncTransport; valid: () => boolean; changed?: () => void; report?: (status: SyncStatus) => void; clock?: SyncClock }) {
    this.repo = options.repo; this.transport = options.transport; this.valid = options.valid;
    this.clock = options.clock ?? defaultClock; this.changed = options.changed ?? (() => {}); this.report = options.report ?? (() => {});
  }
  private current() { return this.alive && this.valid(); }
  private active() { return this.current() && this.online && this.foreground; }
  stop() { this.alive = false; this.controller.abort(); if (this.timer !== undefined) this.clock.cancel(this.timer); }
  setOnline(online: boolean) { this.online = online; if (!online) { this.controller.abort(); this.report({ state: 'offline' }); } else void this.sync(); }
  setForeground(foreground: boolean) { this.foreground = foreground; if (!foreground) this.controller.abort(); else void this.sync(); }
  retry() {
    if (!this.current()) return Promise.resolve();
    this.blocked = false;
    if (this.lastCode === 'NETWORK') { this.notBefore = 0; this.repo.clearRetry(); this.repo.profile.clearRetry(); }
    return this.sync();
  }
  private wake(delay: number) {
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = this.clock.schedule(() => { this.timer = undefined; void this.sync(); }, Math.max(1, delay));
  }
  sync(): Promise<void> {
    if (!this.active() || this.blocked) return Promise.resolve();
    try { this.repo.imports.resume(); this.repo.adjustClock(new Date(this.clock.now()).toISOString()); }
    catch { this.blocked = true; this.report({ state: 'blocked', code: 'LOCAL_STORAGE' }); return Promise.resolve(); }
    this.requested = true;
    if (this.running) return this.running;
    if (this.notBefore - this.clock.now() > this.lastDelay + 1000) this.notBefore = this.clock.now() + this.lastDelay;
    const delay = this.notBefore - this.clock.now();
    if (delay > 0) { this.wake(delay); return Promise.resolve(); }
    this.running = this.loop().finally(() => { this.running = null; if (this.requested && this.active()) void this.sync(); });
    return this.running;
  }
  private async pull() {
    let more = true;
    while (more && this.active()) {
      const after = this.repo.cursor(), page = await this.transport.pull(after, this.controller.signal);
      if (!this.active()) return;
      if (this.repo.applyPage(after, page)) this.changed();
      more = page.has_more;
    }
  }
  private async syncProfile(): Promise<boolean> {
    if (!this.transport.getProfile || !this.transport.updateProfile) return true;
    const profile = this.repo.profile, pending = profile.pending();
    if (pending && pending.state !== 'rejected') {
      const delay = profile.retryDelay(this.clock.now());
      if (delay > 0) { this.report({ state: 'retrying' }); this.requested = false; this.wake(delay); return false; }
      profile.sending(pending.request.operation_id);
      try {
        await this.transport.updateProfile(pending.request, this.controller.signal);
      } catch (error) {
        if (!this.active()) return false;
        if (error instanceof SyncFailure && error.code !== 'IDEMPOTENCY_KEY_REUSED' && !error.retryable && [400, 409].includes(error.status)) {
          profile.reject(pending.request.operation_id, error.code, error.profile); this.changed(); return true;
        }
        throw error;
      }
      if (!this.active()) return false;
      // A replayed receipt can describe an older consent epoch. Confirm the current account state.
      const latest = await this.transport.getProfile(this.controller.signal);
      if (!this.active()) return false;
      profile.accept(pending.request.operation_id, latest); this.changed();
    } else {
      const latest = await this.transport.getProfile(this.controller.signal);
      if (!this.active()) return false;
      if (profile.store(latest)) this.changed();
    }
    return true;
  }
  private async loop() {
    this.controller = new AbortController();
    while (this.requested && this.active()) {
      this.requested = false; let row: QueuedMutation | null = null;
      this.report({ state: 'syncing' });
      try {
        if (!await this.syncProfile()) return;
        await this.pull();
        if (!this.active()) return;
        while (this.active() && (row = this.repo.beginNext(new Date(this.clock.now()).toISOString()))) {
          try {
            const input: CheckinMutation = JSON.parse(row.request_json!);
            const result = await this.transport.mutate(input, this.controller.signal);
            if (!this.active()) return;
            this.repo.acknowledge(row, result); this.changed(); this.failures = 0;
          } catch (error) {
            if (!this.active()) return;
            if (error instanceof SyncFailure && error.code !== 'IDEMPOTENCY_KEY_REUSED' && !error.retryable && [400, 404, 409].includes(error.status)) {
              this.repo.fail(row, error); this.changed();
            } else throw error;
          }
          row = null;
        }
        if (!this.active()) return;
        await this.pull();
        if (!this.active()) return;
        this.failures = 0; this.lastCode = '';
        const retry = this.repo.nextRetry();
        if (retry) { this.report({ state: 'retrying' }); this.wake(Math.max(1, new Date(retry).getTime() - this.clock.now())); }
        else this.report({ state: this.repo.issues().length ? 'issues' : 'synced' });
      } catch (error) {
        if (!this.current()) return;
        if (!this.online) { this.report({ state: 'offline' }); return; }
        if (!this.foreground) return;
        const failure = error instanceof SyncFailure ? error : new SyncFailure('LOCAL_STORAGE');
        if (failure.code === 'STALE_SCOPE') { this.requested = this.active(); return; }
        this.lastCode = failure.code;
        this.requested = false;
        if (failure.retryable) {
          this.failures++;
          const delay = Math.max(failure.retryAfterMs, Math.min(60000, 1000 * 2 ** Math.min(6, this.failures - 1)) * (0.75 + this.clock.random() * 0.25));
          this.notBefore = this.clock.now() + delay;
          this.lastDelay = delay;
          try { if (row) this.repo.defer(row.mutation_id, new Date(this.notBefore).toISOString(), delay); else this.repo.profile.defer(this.clock.now(), delay); }
          catch { this.blocked = true; this.report({ state: 'blocked', code: 'LOCAL_STORAGE' }); return; }
          this.report({ state: 'retrying', code: failure.code }); this.wake(delay);
        } else { this.blocked = true; this.report({ state: 'blocked', code: failure.code }); }
        return;
      }
    }
  }
}
