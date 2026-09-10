import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button } from '../src/components/ui';
export default function Settings() {
  const router = useRouter();
  return <AppScreen><Header /><Copy variant="title">Settings</Copy><Copy>Your check-ins are saved privately on this phone.</Copy><Copy>Account and reminder settings are being built.</Copy><Button secondary label="Back to Today" onPress={() => router.replace('/(tabs)/today')} /></AppScreen>;
}
