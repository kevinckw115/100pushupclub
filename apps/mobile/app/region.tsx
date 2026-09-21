import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
import { useLocal } from '../src/services/local-context';
import { authEnvironment } from '../src/services/auth-client';
import { RegionDirectory, world, region } from '../src/data/regions';
import type { Region } from '../src/data/regions';
import { theme, typography } from '../src/theme/theme';

export default function RegionPicker() {
  const { repo, partition, refresh } = useLocal(), router = useRouter();
  const scope = partition?.id ?? 'device';
  const directory = useMemo(() => repo ? new RegionDirectory(repo, authEnvironment.url ?? null, authEnvironment.key ?? null) : null, [repo]);
  const [parent, setParent] = useState<Region>(world), [path, setPath] = useState<Region[]>([world]);
  const [draft, setDraft] = useState(''), [query, setQuery] = useState(''), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Region | null>(() => { try { const saved = repo?.preference(scope, 'browse_region'); return saved ? region(JSON.parse(saved)) : null; } catch { return null; } });
  const [message, setMessage] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<{ key: string; items: Region[]; cursor: string | null; cached: boolean; error?: string } | null>(null);
  const key = JSON.stringify([parent.id, query, cursor, retry]);
  const current = page?.key === key ? page : null;
  const items = current?.items ?? [], next = current?.cursor ?? null, cached = current?.cached ?? false;
  const busy = !!directory && !current && query.length !== 1;
  const generation = useRef(0), selectionGeneration = useRef(0);
  useEffect(() => { const timer = setTimeout(() => { setQuery(draft.trim()); setCursor(null); }, 300); return () => clearTimeout(timer); }, [draft]);
  useEffect(() => {
    if (!directory || !repo) return;
    const controller = new AbortController(), selectionTicket = selectionGeneration.current;
    const saved = repo.preference(scope, 'browse_region');
    if (saved) {
      try {
        const value = region(JSON.parse(saved));
        void directory.resolve(value.id, controller.signal).then(result => {
          if (controller.signal.aborted || selectionTicket !== selectionGeneration.current) return;
          setSelected(result.region);
          if (result.fallback) setMessage('That region is unavailable. Choose its broader region or World.');
        }, () => {});
      } catch { /* Invalid saved data is omitted by the initial state parser. */ }
    }
    return () => controller.abort();
  }, [directory, repo, scope]);
  useEffect(() => {
    if (!directory) return;
    const controller = new AbortController(), ticket = ++generation.current;
    if (query.length === 1) return () => controller.abort();
    void directory.list(query ? null : parent.id, query, cursor, controller.signal).then(result => {
      if (controller.signal.aborted || ticket !== generation.current) return;
      setPage({ key, ...result });
    }, () => { if (!controller.signal.aborted) setPage({ key, items: [], cursor: null, cached: false, error: 'The region directory is unavailable. You can keep World or try again when connected.' }); });
    return () => controller.abort();
  }, [directory, parent.id, query, cursor, key]);
  const browse = (item: Region) => {
    setDraft(''); setQuery(''); setCursor(null); setParent(item);
    const index = path.findIndex(p => p.id === item.id);
    setPath(index >= 0 ? path.slice(0, index + 1) : [...path, item]);
  };
  const save = (item: Region) => {
    try { if (!repo) return; repo.setPreference(scope, 'browse_region', JSON.stringify(item)); selectionGeneration.current++; refresh(); setSelected(item); setMessage(`${item.label} saved for browsing on this phone.`); }
    catch { setMessage('Could not save this region. Your previous choice is unchanged.'); }
  };
  return <AppScreen><Header /><Copy variant="title">Choose your region</Copy><Copy>Choose a broad region to browse. Nearby uses counties in the US. Elsewhere, choose a state, region or country when a broad locality is unavailable.</Copy>
    {selected && <Notice>Current choice: {selected.label}</Notice>}
    <TextInput accessibilityLabel="Search regions" value={draft} onChangeText={setDraft} placeholder="Search country, state or county" autoCapitalize="none" style={{ ...typography('body'), minHeight: 52, padding: 12, borderWidth: 1, borderRadius: 12, borderColor: theme.colors.textSecondary }} />
    <Section title={query ? 'Search results' : parent.label}>
      {!query && <Button label={`Use ${parent.name}`} onPress={() => save(parent)} />}
      {path.length > 1 && <Button secondary label="Back to broader region" onPress={() => browse(path[path.length - 2])} />}
      {cached && <Notice>Showing a saved directory page. Connect to refresh it.</Notice>}
      {busy && <Notice>Loading regions…</Notice>}
      {query.length === 1 && <Notice>Enter at least two characters to search.</Notice>}
      {current?.error && <Notice>{current.error}</Notice>}
      {items.map(item => <Section key={item.id} title={item.label}><Button label={`Use ${item.name}`} onPress={() => save(item)} />{item.has_children && <Button secondary label={`Browse ${item.name}`} onPress={() => browse(item)} />}</Section>)}
      {!busy && !items.length && !current?.error && query.length !== 1 && <Notice>{query ? 'No matching regions. Try a broader name.' : 'No narrower region is available. You can use this region.'}</Notice>}
      {next && <Button secondary label="Next regions" onPress={() => setCursor(next)} />}
      {cursor && <Button secondary label="First page" onPress={() => setCursor(null)} />}
    </Section>
    {message && <Notice>{message}</Notice>}
    <Button secondary label="Refresh directory" onPress={() => setRetry(value => value + 1)} />
    <Button secondary label="About this directory" onPress={() => router.push('/about')} />
    <Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/today')} />
  </AppScreen>;
}
