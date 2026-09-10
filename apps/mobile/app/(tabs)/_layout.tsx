import { Redirect, Tabs } from 'expo-router';
import { TabBar } from '../../src/components/ui';
import { LoadingStorage, useLocal } from '../../src/services/local-context';

export default function TabLayout() {
  const { ready, partition } = useLocal();
  if (!ready) return <LoadingStorage />;
  if (!partition) return <Redirect href="/welcome" />;
  return <Tabs screenOptions={{ headerShown: false }} tabBar={({ state, navigation }) => <TabBar selected={state.routes[state.index].name} onSelect={name => navigation.navigate(name)} />}>
    <Tabs.Screen name="today" /><Tabs.Screen name="club" /><Tabs.Screen name="circles" /><Tabs.Screen name="you" />
  </Tabs>;
}
