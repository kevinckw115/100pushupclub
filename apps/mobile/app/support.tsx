import { useState } from 'react';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice } from '../src/components/ui';
const configuredEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
const supportEmail = configuredEmail && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(configuredEmail) ? configuredEmail : null;
export default function Support() {
  const router = useRouter(), [message, setMessage] = useState<string | null>(null);
  return <AppScreen><Header /><Copy variant="title">Support</Copy><Copy>For account or app problems, describe what happened and your app version. Do not send sign-in codes, invitation codes, deletion recovery proofs or your full personal database.</Copy>
    {supportEmail ? <><Copy selectable>{supportEmail}</Copy><Button label="Email support" onPress={() => { void Linking.openURL('mailto:' + encodeURIComponent(supportEmail) + '?subject=100pushupclub%20support').catch(() => setMessage('Could not open email. Copy the support address into your email app.')); }} /></> : <Notice>A support contact has not been configured for this development build.</Notice>}
    <Copy>Report or block community members from the menu beside their alias. Account deletion can be requested here after email verification.</Copy><Button secondary label="Account deletion and status" onPress={() => router.push('/delete-account')} />{message && <Notice>{message}</Notice>}<Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} />
  </AppScreen>;
}
