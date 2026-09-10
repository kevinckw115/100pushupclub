import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Row } from '../../src/components/ui';
export default function You() {
  const router = useRouter();
  return <AppScreen><Header /><Copy variant="title">You</Copy><Copy>Tracking on this phone</Copy><Copy>Your check-ins are private. No account needed to keep going.</Copy><Row title="Settings" onPress={() => router.push('/settings')} /></AppScreen>;
}
