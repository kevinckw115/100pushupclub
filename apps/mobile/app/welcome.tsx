import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice } from '../src/components/ui';
import { LoadingStorage, useLocal } from '../src/services/local-context';

export default function Welcome() {
  const { repo, ready, partition, refresh } = useLocal();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  if (!ready) return <LoadingStorage />;
  if (partition) return <Redirect href="/(tabs)/today" />;
  const start = () => {
    try { repo!.startGuest(new Date().toISOString()); refresh(); router.replace('/(tabs)/today'); }
    catch { setError('Could not save your setup. Please try again.'); }
  };
  return <AppScreen><Header />
    <Copy variant="headline" style={{ marginTop: 40 }}>100 is the goal. Start with what you can.</Copy>
    <Copy>Wall, knee, incline, or standard. Every set counts.</Copy>
    <Copy>Your check-ins stay on this phone. You can start without an account or internet connection.</Copy>
    {error && <Notice error>{error}</Notice>}
    <Button label="Get started" onPress={start} />
  </AppScreen>;
}
