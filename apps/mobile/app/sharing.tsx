import { useState } from 'react';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { AppScreen, Header, Copy, Button, Notice, Section } from '../src/components/ui';
import { useLocal, LoadingStorage } from '../src/services/local-context';
import { useSync } from '../src/services/sync-context';
import { region, world } from '../src/data/regions';
import type { OwnProfile, ProfileMutation, ProfileRepository } from '../src/data/local/profile';
import { PARTICIPATION_TERMS_VERSION } from '../src/data/local/profile';
import { theme, typography } from '../src/theme/theme';

export default function Sharing() {
  const router = useRouter(), { repo, partition } = useLocal(), sync = useSync();
  if (!repo) return <LoadingStorage />;
  const profile = sync.repository?.profile.cached();
  return <AppScreen><Header /><Copy variant="title">Alias and public sharing</Copy>
    {partition?.kind !== 'account' ? <><Copy>Sign in to choose whether future check-ins contribute to the Club.</Copy><Button label="Sign in" onPress={() => router.push('/auth')} /></> : profile && sync.repository ?
      <ProfileForm key={`${partition.id}:${repo.preference(partition.id, 'profile_ack') ?? ''}`} initial={profile} store={sync.repository.profile} /> :
      <><Notice>Connect to load your current account settings.</Notice><Button label="Retry connection" onPress={sync.retry} /></>}
    <Button secondary label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} />
  </AppScreen>;
}

function ProfileForm({ initial, store }: { initial: OwnProfile; store: ProfileRepository }) {
  const router = useRouter(), { repo, partition, refresh } = useLocal(), sync = useSync();
  const draft = store.pending()?.request;
  const [baseline, setBaseline] = useState(initial), [alias, setAlias] = useState(draft?.alias ?? initial.alias);
  const [enabled, setEnabled] = useState(draft?.public_enabled ?? initial.public_enabled), [regionId, setRegionId] = useState(draft?.region_id !== undefined ? draft.region_id : initial.region_id);
  const [terms, setTerms] = useState(draft?.accepted_terms_version === PARTICIPATION_TERMS_VERSION || initial.participation_terms_version === PARTICIPATION_TERMS_VERSION);
  const [message, setMessage] = useState<string | null>(null);
  let browsing = world;
  try { const saved = repo!.preference(partition!.id, 'browse_region'); if (saved) browsing = region(JSON.parse(saved)); } catch { /* World is the safe default. */ }
  const pending = store.pending(), current = store.cached()!, locked = !!pending;
  const regionLabel = regionId === null ? 'World' : regionId === browsing.id ? browsing.label : 'Your selected account region';
  const restore = (keepDraft: boolean) => {
    try {
      store.discardRejected(); setBaseline(current);
      if (!keepDraft) { setAlias(current.alias); setEnabled(current.public_enabled); setRegionId(current.region_id); setTerms(current.participation_terms_version === PARTICIPATION_TERMS_VERSION); }
      setMessage(keepDraft ? 'Review your draft against the current account settings, then save again.' : null); refresh();
    } catch { setMessage('Could not update the local draft. Please retry.'); }
  };
  const save = () => {
    try {
      const fields: Omit<ProfileMutation, 'operation_id'> = {};
      if (enabled && !terms) { setMessage('Accept the participation terms before enabling public sharing.'); return; }
      if (terms && baseline.participation_terms_version !== PARTICIPATION_TERMS_VERSION) fields.accepted_terms_version = PARTICIPATION_TERMS_VERSION;
      if (alias.trim() !== baseline.alias) fields.alias = alias.trim();
      if (enabled !== baseline.public_enabled) fields.public_enabled = enabled;
      if (regionId !== baseline.region_id) fields.region_id = regionId;
      if (fields.public_enabled !== undefined || fields.region_id !== undefined) fields.expected_consent_epoch = baseline.consent_epoch;
      store.queue(fields); setMessage(null); refresh(); sync.retry();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save this change on your phone.'); }
  };
  return <>
    <Notice>Last confirmed sharing: {current.public_enabled ? 'on' : 'off'}. {pending ? 'Your new choice is not yet confirmed.' : 'Only future eligible check-ins can be shared.'}</Notice>
    {current.alias_change_required && <Notice error>Your alias needs to change before you can participate publicly again. Choose a respectful name below.</Notice>}
    <Section title="Your alias"><Copy>Use 3 to 20 letters, numbers or underscores. Your email stays private.</Copy>
      <TextInput accessibilityLabel="Public alias" value={alias} onChangeText={setAlias} editable={!locked} autoCapitalize="none" autoCorrect={false} maxLength={20} style={{ ...typography('body'), minHeight: 52, padding: 12, borderWidth: 1, borderRadius: 12, borderColor: theme.colors.textSecondary }} />
    </Section>
    <Section title="Participation terms"><Copy>Use respectful aliases and circle names. Do not harass, impersonate others, or use hateful or sexually explicit names. Report abuse and block accounts you do not want to see. Moderators may hide activity, require a name change, or suspend an account.</Copy><Copy>Your personal log works without public participation. Sharing and circles are optional.</Copy>
      <Button secondary label={terms ? 'Participation terms accepted' : 'Accept participation terms'} onPress={() => setTerms(true)} disabled={locked || terms} />
    </Section>
    <Section title="Public sharing"><Copy>Share your alias, pushup count and approximate recency with the Club. Your exact check-in time is private. Imported guest history is never shared.</Copy>
      <Button secondary label={`Sharing choice: ${enabled ? 'on' : 'off'}`} onPress={() => setEnabled(!enabled)} disabled={locked} />
      <Copy>Turning sharing off hides previous public contributions after the server confirms it. Turning it back on does not republish history. Changing your public region also starts fresh.</Copy>
      <Copy>Public region: {regionLabel}</Copy>
      <Button secondary label={`Use browsing region: ${browsing.label}`} onPress={() => setRegionId(browsing.id === 'world' ? null : browsing.id)} disabled={locked} />
      <Button secondary label="Use World for public sharing" onPress={() => setRegionId(null)} disabled={locked} />
      <Button secondary label="Choose a browsing region" onPress={() => router.push('/region')} disabled={locked} />
    </Section>
    {pending ? pending.state === 'rejected' ? <>
      <Notice error>{pending.code === 'CONSENT_CONFLICT' ? 'Sharing changed on another device. Review the current account settings before trying again.' : pending.code === 'ALIAS_UNAVAILABLE' ? 'That alias is unavailable. Choose another one.' : pending.code === 'TERMS_REQUIRED' ? 'Review and accept the current participation terms.' : pending.code === 'ALIAS_CHANGE_REQUIRED' ? 'Choose a new respectful alias before sharing again.' : 'The account change was not accepted. Review your alias and region.'}</Notice>
      <Button label="Edit rejected change" onPress={() => restore(true)} /><Button secondary label="Use account settings" onPress={() => restore(false)} />
    </> : <><Notice>Saved on this phone; waiting for server confirmation. New check-ins remain private. Sharing may still be on until this change is confirmed.</Notice><Button label="Retry sharing change" onPress={sync.retry} /></> : <Button label="Save account settings" onPress={save} />}
    {message && <Notice>{message}</Notice>}
  </>;
}
