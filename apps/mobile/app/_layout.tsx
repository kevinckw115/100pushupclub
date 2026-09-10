import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import tokens from '../../../design/tokens.json';

export default function RootLayout() {
  return <><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: tokens.colors.canvas } }} /></>;
}
