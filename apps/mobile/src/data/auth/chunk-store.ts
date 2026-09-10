export interface SecretStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
const keys = ['pushupclub.auth', 'pushupclub.auth-user', 'pushupclub.auth-code-verifier'];
const size = 1500, maxChunks = 64;
// Two versioned slots. The manifest is the only commit point; the slot journal
// is written before its chunks, so even an interrupted write can be cleaned.
export class ChunkStore implements SecretStore {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly store: SecretStore;
  constructor(store: SecretStore) { this.store = store; }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run); this.tail = result.catch(() => {}); return result;
  }
  private check(key: string) { if (!keys.includes(key)) throw new Error('Unknown session storage key.'); }
  private async manifest(key: string): Promise<{ slot: number; count: number } | null> {
    const raw = await this.store.getItem(key + '.manifest');
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (![0, 1].includes(value.slot) || !Number.isInteger(value.count) || value.count < 1 || value.count > maxChunks) throw new Error('Session storage needs recovery.');
    return value;
  }
  private async clean(key: string, slot: number) {
    const prefix = `${key}.${slot}`;
    const raw = await this.store.getItem(prefix + '.journal');
    if (raw === null) return;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 1 || count > maxChunks) throw new Error('Session storage needs recovery.');
    for (let n = 0; n < count; n++) await this.store.removeItem(`${prefix}.${n}`);
    await this.store.removeItem(prefix + '.journal');
  }
  getItem(key: string) { return this.serial(async () => {
    this.check(key); const active = await this.manifest(key);
    if (!active) { await this.clean(key, 0); await this.clean(key, 1); return null; }
    let value = '';
    for (let n = 0; n < active.count; n++) {
      const chunk = await this.store.getItem(`${key}.${active.slot}.${n}`);
      if (chunk === null) throw new Error('Session storage needs recovery.');
      value += chunk;
    }
    await this.clean(key, 1 - active.slot);
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded !== 'string') throw new Error('Session storage needs recovery.');
    return decoded;
  }); }
  setItem(key: string, value: string) { return this.serial(async () => {
    this.check(key);
    const encoded = JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
    const count = Math.ceil(encoded.length / size);
    if (count > maxChunks) throw new Error('Session is too large for secure storage.');
    const active = await this.manifest(key), slot = active ? 1 - active.slot : 0;
    await this.clean(key, slot);
    await this.store.setItem(`${key}.${slot}.journal`, String(count));
    for (let n = 0; n < count; n++) await this.store.setItem(`${key}.${slot}.${n}`, encoded.slice(n * size, (n + 1) * size));
    await this.store.setItem(key + '.manifest', JSON.stringify({ slot, count }));
    // Old chunks are collected on the next read/write, avoiding a cleanup error
    // being reported as a failed session commit.
  }); }
  removeItem(key: string) { return this.serial(async () => {
    this.check(key); await this.store.removeItem(key + '.manifest');
    await this.clean(key, 0); await this.clean(key, 1);
  }); }
  async clear() { for (const key of keys) await this.removeItem(key); }
}
