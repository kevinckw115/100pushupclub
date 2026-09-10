import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import tokens from '../../../design/tokens.json';
import { LocalProvider, useLocal } from '../src/services/local-context';
import { AuthProvider } from '../src/services/auth-context';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: tokens.colors.canvas, padding: 24 }}><Text>Opening 100pushupclub…</Text></View>;
  return <LocalProvider><AuthProvider><Navigation /></AuthProvider></LocalProvider>;
}

function Navigation() {
  const { partition } = useLocal();
  return <><StatusBar style="dark" /><Stack key={partition?.id ?? 'welcome'} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: tokens.colors.canvas } }} /></>;
}
