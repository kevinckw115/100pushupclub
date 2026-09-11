import { useLocalSearchParams } from 'expo-router';
import { CircleForm } from '../../src/components/circle-form';
export default function JoinCircle() { const { code } = useLocalSearchParams<{ code?: string }>(); return <CircleForm mode="join" initialCode={typeof code === 'string' ? code.slice(0, 200) : ''} />; }
