import { Linking } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
export default function About() {
  const router = useRouter(), [message, setMessage] = useState<string | null>(null);
  const open = (url: string) => { void Linking.openURL(url).catch(() => setMessage('Could not open the website. Please try again when connected.')); };
  return <AppScreen><Header /><Copy variant="title">About the directory</Copy><Section title="Geographical data"><Copy>Geographical data from GeoNames, licensed under Creative Commons Attribution 4.0. Snapshot: September 11, 2026. Names and administrative areas were adapted into a broad-region hierarchy for 100pushupclub.</Copy><Copy>Coverage includes source countries and first-level regions. US counties and county equivalents are available as broad localities; other countries use a state, region or country until broader locality coverage is reviewed. GeoNames data may be incomplete or outdated.</Copy><Button secondary label="Visit GeoNames" onPress={() => open('https://www.geonames.org/')} /><Button secondary label="Read the data license" onPress={() => open('https://creativecommons.org/licenses/by/4.0/')} /></Section>{message && <Notice error>{message}</Notice>}<Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} /></AppScreen>;
}
