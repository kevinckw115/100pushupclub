import { useRouter } from 'expo-router';
import { useState } from 'react';
import { AppScreen, Header, Copy, Row, Button, Section } from '../../src/components/ui';
import { useLocal } from '../../src/services/local-context';
import { shiftDate } from '../../src/domain/calendar';
export default function You() {
  const router = useRouter();
  const { repo, partition, date } = useLocal();
  const [ending, setEnding] = useState<string | null>(null);
  if (!repo || !partition) return null;
  const end = ending ?? date;
  const history = repo.history(partition.id, end);
  const active = history.filter(day => BigInt(day.total) > 0n).length;
  const goals = history.filter(day => BigInt(day.total) >= 100n).length;
  return <AppScreen><Header /><Copy variant="title">You</Copy><Copy>Tracking on this phone</Copy><Row title="Settings" onPress={() => router.push('/settings')} />
    <Section title="Your history"><Copy>{history.at(-1)!.date} – {end}</Copy><Copy>{active} active {active === 1 ? 'day' : 'days'} · {goals} {goals === 1 ? 'day' : 'days'} at 100 in this period</Copy>
      {history.map(day => <Row key={day.date} title={day.date} detail={day.total === '0' ? '—' : `${day.total} pushups`} onPress={() => router.push({ pathname: '/history/[date]', params: { date: day.date } })} />)}
      <Button label="Older 30 days" secondary onPress={() => setEnding(shiftDate(end, -30))} />
      {end !== date && <Button label="Back to latest 30 days" secondary onPress={() => setEnding(null)} />}
    </Section>
  </AppScreen>;
}
