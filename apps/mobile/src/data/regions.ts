import type { LocalRepository } from './local/repository.ts';
import type { Region } from '../../../../contracts/domain.ts';
export type { Region, RegionPage, ResolvedRegion } from '../../../../contracts/domain.ts';
export const world: Region = { id: 'world', parent_id: null, kind: 'world', name: 'World', label: 'World', has_children: true };
const validId = (id: unknown): id is string => typeof id === 'string' && /^(world|gn:[1-9]\d{0,18})$/.test(id);
export function region(value: unknown): Region {
  const r = value as Region;
  if (!r || !validId(r.id) || (r.parent_id !== null && !validId(r.parent_id)) || !['world', 'country', 'admin1', 'locality'].includes(r.kind) || typeof r.name !== 'string' || !r.name || r.name.length > 400 || typeof r.label !== 'string' || r.label.length > 1200 || typeof r.has_children !== 'boolean') throw new Error('Invalid directory response.');
  return { id: r.id, parent_id: r.parent_id, kind: r.kind, name: r.name, label: r.label, has_children: r.has_children };
}
export class RegionDirectory {
  readonly local: LocalRepository; readonly url: string | null; readonly key: string | null;
  constructor(local: LocalRepository, url: string | null, key: string | null) { this.local = local; this.url = url; this.key = key; }
  private validate(operation: string, value: Record<string, unknown>): Record<string, unknown> {
    if (!value || typeof value.version !== 'string' || value.version.length > 100) throw new Error('Invalid directory response.');
    if (operation === 'list_regions') {
      if (!Array.isArray(value.items) || value.items.length > 50 || (value.next_cursor !== null && (typeof value.next_cursor !== 'string' || value.next_cursor.length > 1024))) throw new Error('Invalid directory page.');
      return { version: value.version, items: value.items.map(region), next_cursor: value.next_cursor };
    }
    if (!Array.isArray(value.ancestors) || !value.ancestors.length || value.ancestors.length > 4 || (value.fallback_reason !== null && value.fallback_reason !== 'MISSING_REGION')) throw new Error('Invalid region path.');
    const selected = region(value.region), ancestors = value.ancestors.map(region);
    if (ancestors[0].id !== 'world' || ancestors.at(-1)!.id !== selected.id || ancestors.some((item, index) => index > 0 && item.parent_id !== ancestors[index - 1].id)) throw new Error('Invalid region ancestry.');
    return { version: value.version, region: selected, ancestors, fallback_reason: value.fallback_reason };
  }
  private async read(operation: string, body: unknown, signal: AbortSignal): Promise<{ value: Record<string, unknown>; cached: boolean }> {
    const cacheKey = JSON.stringify([operation, body]);
    try {
      if (!this.url || !this.key) throw new Error('Region directory is not connected yet.');
      const controller = new AbortController(), abort = () => controller.abort();
      if (signal.aborted) throw new Error('Cancelled');
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 10000);
      let value: Record<string, unknown>;
      try {
        const response = await fetch(this.url + '/rest/v1/rpc/' + operation, { method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        if (!response.ok) throw new Error('Region directory could not be loaded.');
        const text = await response.text(); if (text.length > 150000) throw new Error('Invalid directory size.');
        value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid directory response.');
        value = this.validate(operation, value);
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
      if (signal.aborted) throw new Error('Cancelled');
      this.local.db.transaction(() => {
        this.local.db.run("INSERT OR REPLACE INTO cached_queries(identity,scope,request_key,payload,fetched_at,expiry) VALUES('directory','regions',?,?,?,?)", cacheKey, JSON.stringify(value), new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());
        this.local.db.run("DELETE FROM cached_queries WHERE identity='directory' AND scope='regions' AND request_key NOT IN (SELECT request_key FROM cached_queries WHERE identity='directory' AND scope='regions' ORDER BY fetched_at DESC,request_key LIMIT 20)");
      });
      return { value, cached: false };
    } catch (error) {
      if (signal.aborted) throw error;
      const saved = this.local.db.all<{ payload: string }>("SELECT payload FROM cached_queries WHERE identity='directory' AND scope='regions' AND request_key=?", cacheKey)[0];
      if (saved) return { value: this.validate(operation, JSON.parse(saved.payload)), cached: true };
      throw error;
    }
  }
  async list(parent: string | null, search: string, cursor: string | null, signal: AbortSignal) {
    const { value, cached } = await this.read('list_regions', { parent_id: parent, search: search.trim(), cursor, limit: 50 }, signal);
    if (!Array.isArray(value.items) || value.items.length > 50 || (value.next_cursor !== null && (typeof value.next_cursor !== 'string' || value.next_cursor.length > 1024))) throw new Error('Invalid directory page.');
    return { items: value.items.map(region), cursor: value.next_cursor as string | null, cached };
  }
  async resolve(id: string, signal: AbortSignal) {
    const { value, cached } = await this.read('resolve_region', { region_id: id }, signal);
    if (!Array.isArray(value.ancestors) || value.ancestors.length > 4 || (value.fallback_reason !== null && value.fallback_reason !== 'MISSING_REGION')) throw new Error('Invalid region path.');
    return { region: region(value.region), ancestors: value.ancestors.map(region), fallback: value.fallback_reason === 'MISSING_REGION', cached };
  }
}
