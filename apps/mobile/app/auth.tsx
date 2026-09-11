import { useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice } from '../src/components/ui';
import { useAuth } from '../src/services/auth-context';
import { useLocal } from '../src/services/local-context';
import { theme, typography } from '../src/theme/theme';

export default function Auth() {
  const auth = useAuth(), router = useRouter();
  const { partition } = useLocal();
  const [email, setEmail] = useState(''), [code, setCode] = useState('');
  const [sent, setSent] = useState(false), [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (!wait) return; const timer = setTimeout(() => setWait(Math.max(0, wait - 1)), 1000); return () => clearTimeout(timer); }, [wait]);
  const run = async (verify: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);
    try {
      if (verify) {
        const accepted = await auth.verify(email.trim(), code.trim());
        if (accepted && live.current) router.replace('/(tabs)/today');
      } else { await auth.send(email.trim()); if (live.current) { setSent(true); setWait(60); setMessage('Check your email for a sign-in code.'); } }
    } catch (error) { if (live.current) setMessage(error instanceof Error ? error.message : 'Could not sign in. Try again.'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const inputStyle = { ...typography('body'), minHeight: 52, padding: 12, borderWidth: 1, borderRadius: 12, borderColor: theme.colors.textSecondary };
  return <AppScreen><Header /><Copy variant="title">Your account</Copy>
    <Copy>Sign in or recover your account with a code sent to your email. Your guest check-ins stay separate until you choose to import them.</Copy>
    {!auth.connected ? <Notice>Account sign-in is not connected yet. You can keep tracking privately on this phone.</Notice> : <>
      {auth.web && <Notice>This browser preview keeps sign-in only while the page is open. The phone app uses secure session storage.</Notice>}
      {partition?.kind === 'account' && <Notice>Use the same account email to reconnect. To change accounts, sign out in Settings first.</Notice>}
      <Copy>Email</Copy><TextInput accessibilityLabel="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" value={email} editable={!sent && !busy} onChangeText={setEmail} style={inputStyle} />
      {sent && <><Copy>Email code</Copy><TextInput accessibilityLabel="Email code" keyboardType="number-pad" autoComplete="one-time-code" value={code} onChangeText={setCode} maxLength={10} style={inputStyle} /><Button label="Verify code" busy={busy} onPress={() => void run(true)} /></>}
      {wait ? <Copy>Request another code in {wait}s.</Copy> : <Button secondary={sent} label={sent ? 'Send another code' : 'Send code'} busy={busy} onPress={() => void run(false)} />}
      {sent && !busy && <Button secondary label="Use a different email" onPress={() => { setSent(false); setCode(''); }} />}
    </>}
    {(message || auth.message) && <Notice>{message ?? auth.message}</Notice>}
    {sent && auth.message && <Button secondary label="Retry account connection" busy={busy} onPress={() => { void auth.recover().then(ok => { if (ok) router.replace('/(tabs)/today'); }).catch(() => setMessage('Could not reconnect. Your local check-ins are safe.')); }} />}
    <Button secondary label="Cancel sign-in" onPress={() => { void auth.cancel().then(() => router.replace('/(tabs)/today')).catch(() => setMessage('Could not close sign-in storage. Please try again.')); }} />
  </AppScreen>;
}
