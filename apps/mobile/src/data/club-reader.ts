import type { ClubPage, ClubTransport, PublicFeedRow } from './club.ts';
import { isScope } from './club.ts';
import { SyncFailure } from './sync/protocol.ts';
import type { SyncClock } from './sync/engine.ts';
export interface ClubState { scope: string; page: ClubPage | null; rows: PublicFeedRow[]; updates: ClubPage | null; status: 'waiting' | 'loading' | 'recent' | 'offline' | 'error'; code?: string; fetchedAt: number | null; observedAt: number }
const defaultClock: SyncClock = { now: Date.now, random: Math.random, schedule: (run, delay) => setTimeout(run, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
export class ClubReader {
  private value: ClubState = { scope: 'world', page: null, rows: [], updates: null, status: 'waiting', fetchedAt: null, observedAt: 0 };
  private listeners = new Set<() => void>(); private alive = true; private active = false; private online = true;
  private generation = 0; private controller = new AbortController(); private running: Promise<void> | null = null;
  private timer: unknown; private nextAt = 0; private waitMs = 0; private queued = false;
  readonly transport: ClubTransport; readonly valid: () => boolean; readonly clock: SyncClock;
  constructor(transport: ClubTransport, valid: () => boolean, clock: SyncClock = defaultClock) { this.transport = transport; this.valid = valid; this.clock = clock; }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(change: Partial<ClubState>) { this.value = { ...this.value, ...change, observedAt: this.clock.now() }; for (const listener of this.listeners) listener(); }
  private ready() { return this.alive && this.active && this.online && this.valid(); }
  private cancel() { this.generation++; this.controller.abort(); if (this.timer !== undefined) this.clock.cancel(this.timer); this.timer = undefined; this.queued = false; }
  stop() { this.alive = false; this.cancel(); this.listeners.clear(); }
  invalidate() { this.cancel(); this.publish({ page: null, rows: [], updates: null, status: this.online ? 'waiting' : 'offline' }); void this.refresh(); }
  setScope(scope: string) {
    if (!isScope(scope)) throw new Error('Invalid browsing scope.');
    if (scope === this.value.scope) return;
    this.cancel(); this.publish({ scope, page: null, rows: [], updates: null, status: 'waiting', fetchedAt: null }); void this.refresh();
  }
  setActive(active: boolean) {
    if (active === this.active) return; this.active = active;
    if (!active) { this.cancel(); this.publish({ page: null, rows: [], updates: null, status: 'waiting' }); } else void this.refresh();
  }
  setOnline(online: boolean) {
    if (online === this.online) return; this.online = online;
    if (!online) { this.cancel(); this.publish({ page: null, rows: [], updates: null, status: 'offline' }); } else void this.refresh();
  }
  private schedule(mode: 'refresh' | 'more', delay: number) {
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = this.clock.schedule(() => { this.timer = undefined; void this.request(mode); }, Math.max(1, delay));
  }
  refresh = () => this.request('refresh');
  more = () => this.request('more');
  showUpdates = () => {
    if (!this.value.updates) return;
    const page = this.value.updates; this.publish({ page, rows: page.items, updates: null });
  };
  private request(mode: 'refresh' | 'more'): Promise<void> {
    if (!this.ready()) return Promise.resolve();
    if (this.running) { if (mode === 'refresh') this.queued = true; return this.running; }
    if (mode === 'more' && (!this.value.page?.next_cursor || this.value.updates || this.value.rows.length >= 100)) return Promise.resolve();
    if (this.nextAt - this.clock.now() > this.waitMs + 1000) this.nextAt = this.clock.now() + this.waitMs;
    if (this.nextAt > this.clock.now()) { this.schedule(mode, this.nextAt - this.clock.now()); return Promise.resolve(); }
    this.running = this.fetch(mode).finally(() => { this.running = null; if (this.queued && this.ready()) { this.queued = false; void this.refresh(); } });
    return this.running;
  }
  private async fetch(mode: 'refresh' | 'more') {
    const ticket = this.generation, scope = this.value.scope, previous = this.value.page;
    const cursor = mode === 'more' ? previous!.next_cursor : null;
    this.controller = new AbortController(); this.nextAt = this.clock.now() + 10000; this.waitMs = 10000;
    this.publish({ status: 'loading', code: undefined });
    try {
      const page = await this.transport.read(scope, cursor, this.controller.signal);
      if (!this.ready() || ticket !== this.generation) return;
      if (mode === 'more') {
        if (page.window.as_of !== previous!.window.as_of || page.effective_scope.id !== previous!.effective_scope.id || (page.next_cursor && page.next_cursor === cursor)) throw new SyncFailure('INVALID_CURSOR');
        const ids = new Set(this.value.rows.map(row => row.id));
        this.publish({ page, rows: [...this.value.rows, ...page.items.filter(row => !ids.has(row.id))].slice(0, 100), updates: null });
      } else {
        const ids = new Set(this.value.rows.map(row => row.id));
        const newRows = previous && page.items.some(row => !ids.has(row.id));
        // Refetch immediately removes revoked rows and corrects counts; only new rows await user insertion.
        this.publish({ page, rows: newRows ? page.items.filter(row => ids.has(row.id)) : page.items, updates: newRows ? page : null });
      }
      this.publish({ status: 'recent', fetchedAt: this.clock.now() }); this.schedule('refresh', 30000);
    } catch (error) {
      if (!this.ready() || ticket !== this.generation) return;
      const failure = error instanceof SyncFailure ? error : new SyncFailure('PROTOCOL');
      this.publish({ page: null, rows: [], updates: null, status: 'error', code: failure.code });
      if (failure.retryable || failure.code === 'INVALID_CURSOR') {
        this.waitMs = Math.max(failure.code === 'INVALID_CURSOR' ? 10000 : 30000, failure.retryAfterMs);
        this.nextAt = this.clock.now() + this.waitMs; this.schedule('refresh', this.waitMs);
      }
    }
  }
}
