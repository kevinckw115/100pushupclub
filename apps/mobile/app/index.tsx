import { Redirect } from 'expo-router';
import { LoadingStorage, useLocal } from '../src/services/local-context';
export default function Index() {
  const { ready, partition } = useLocal();
  if (!ready) return <LoadingStorage />;
  return <Redirect href={partition ? '/(tabs)/today' : '/welcome'} />;
}
