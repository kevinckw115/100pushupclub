import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, ProgressRing, Section, Notice, Row } from '../../src/components/ui';
import { useLocal } from '../../src/services/local-context';

export default function Today() {
  const { repo, partition, date } = useLocal();
  const router = useRouter();
  if (!repo || !partition) return null;
  const total = repo.total(partition.id, date);
  const rows = repo.day(partition.id, date);
  const remaining = BigInt(total) < 100n ? 100n - BigInt(total) : 0n;
  return <AppScreen><Header onSettings={() => router.push('/settings')} />
    <Copy variant="caption" style={{ textAlign: 'center', textTransform: 'uppercase' }}>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</Copy>
    <Copy variant="headline" style={{ textAlign: 'center' }}>A little at a time.</Copy>
    <ProgressRing total={total} />
    <Copy style={{ textAlign: 'center' }}>{remaining > 0n ? `${remaining} to go. Take your time.` : '100 today. Nicely done.'}</Copy>
    <Section title="Your check-ins">
      {rows.length ? rows.map(row => <Row key={row.id} title={`${row.quantity} pushups`} detail={new Date(row.occurred_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} />) : <Copy>Start with a few.</Copy>}
    </Section>
    <Notice>{partition.kind === 'guest' ? 'Saved on this phone. Your check-ins are private.' : 'Your personal check-ins'}</Notice>
  </AppScreen>;
}
