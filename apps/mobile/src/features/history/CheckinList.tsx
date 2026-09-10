import { useMemo, useState } from 'react';
import { Button, Copy, Row, Section } from '../../components/ui';
import { useLocal } from '../../services/local-context';
import type { LocalCheckin } from '../../data/local/repository';

export function CheckinList({ date, onEdit }: { date: string; onEdit: (record: LocalCheckin) => void }) {
  const { repo, partition } = useLocal();
  const [pages, setPages] = useState(1);
  const rows = useMemo(() => {
    if (!repo || !partition) return [];
    let results: LocalCheckin[] = [];
    for (let page = 0; page < pages; page++) {
      const last = results.at(-1);
      const batch = repo.day(partition.id, date, last ? { time: last.occurred_at, id: last.id } : undefined);
      results = results.concat(batch);
      if (batch.length < 100) break;
    }
    return results;
  // The provider refreshes its partition snapshot after every successful commit.
  }, [repo, partition, date, pages]);
  return <Section title="Your check-ins">
    {rows.length ? rows.map(row => <Row key={row.id} title={`${row.quantity} pushups`} detail={new Date(row.occurred_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: row.recorded_timezone })} onPress={() => onEdit(row)} />) : <Copy>No check-ins on this day.</Copy>}
    {rows.length === pages * 100 && <Button label="Older check-ins" secondary onPress={() => setPages(previous => previous + 1)} />}
  </Section>;
}
