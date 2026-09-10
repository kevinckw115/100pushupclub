import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import tokens from '../../../design/tokens.json';
import { LocalProvider } from '../src/services/local-context';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: tokens.colors.canvas, padding: 24 }}><Text>Opening 100pushupclub…</Text></View>;
  return <LocalProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: tokens.colors.canvas } }} /></LocalProvider>;
}
