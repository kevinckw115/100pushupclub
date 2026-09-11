import { SyncFailure } from './sync/protocol.ts';
import type { SyncClock } from './sync/engine.ts';
export interface CheckedState<T> { value: T | null; status: 'waiting' | 'loading' | 'ready' | 'offline' | 'error'; code?: string }
const systemClock: SyncClock = { now: Date.now, random: Math.random, schedule: (run, delay) => setTimeout(run, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
/** In-memory authorized view. No disk cache; late responses cannot repopulate a paused or invalidated screen. */
export class CheckedReader<T> {
  private state: CheckedState<T> = { value: null, status: 'waiting' };
  private listeners = new Set<() => void>(); private active = false; private online = true; private alive = true;
  private generation = 0; private controller: AbortController | null = null; private timer: unknown; private next = 0; private delay = 0;
  private readonly read: (signal: AbortSignal) => Promise<T>; private readonly valid: () => boolean; private readonly clock: SyncClock;
  constructor(read: (signal: AbortSignal) => Promise<T>, valid: () => boolean, clock = systemClock) { this.read = read; this.valid = valid; this.clock = clock; }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(value: CheckedState<T>) { this.state = value; for (const listener of this.listeners) listener(); }
  private available() { return this.alive && this.active && this.online && this.valid(); }
  private cancel() { this.generation++; this.controller?.abort(); this.controller = null; if (this.timer !== undefined) this.clock.cancel(this.timer); this.timer = undefined; }
  private wake(delay: number) { if (this.timer !== undefined) this.clock.cancel(this.timer); this.timer = this.clock.schedule(() => { this.timer = undefined; void this.refresh(); }, Math.max(1, delay)); }
  setActive(value: boolean) { if (value === this.active) return; this.active = value; if (!value) { this.cancel(); this.emit({ value: null, status: 'waiting' }); } else if (!this.online) this.emit({ value: null, status: 'offline' }); else void this.refresh(); }
  setOnline(value: boolean) { if (value === this.online) return; this.online = value; if (!value) { this.cancel(); this.emit({ value: null, status: 'offline' }); } else void this.refresh(); }
  invalidate() { this.cancel(); this.emit({ value: null, status: this.online ? 'waiting' : 'offline' }); if (this.available()) void this.refresh(); }
  stop() { this.alive = false; this.cancel(); this.emit({ value: null, status: 'waiting' }); }
  async refresh() {
    if (!this.available() || this.controller) return;
    if (this.next - this.clock.now() > this.delay + 1000) this.next = this.clock.now() + this.delay;
    if (this.next > this.clock.now()) { this.wake(this.next - this.clock.now()); return; }
    const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.delay = 10000; this.next = this.clock.now() + this.delay; this.emit({ ...this.state, status: 'loading' });
    try {
      const value = await this.read(controller.signal);
      if (generation !== this.generation || !this.available()) return;
      this.emit({ value, status: 'ready' }); this.wake(30000);
    } catch (error) {
      if (generation !== this.generation || !this.available()) return;
      const failure = error instanceof SyncFailure ? error : new SyncFailure('PROTOCOL');
      this.emit({ value: null, status: 'error', code: failure.code });
      this.delay = Math.max(10000, failure.retryAfterMs); this.next = this.clock.now() + this.delay;
      if (failure.retryable) this.wake(this.delay);
    } finally { if (generation === this.generation) this.controller = null; }
  }
}
