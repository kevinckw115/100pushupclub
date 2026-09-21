import { useRouter } from 'expo-router';
import { Button, Copy, Notice } from './ui';
import { useLocal } from '../services/local-context';
import { useSync } from '../services/sync-context';
import { useAuth } from '../services/auth-context';
import { authEnvironment } from '../services/auth-client';
import type { CheckedState } from '../data/checked-reader';
export function CircleGate() {
  const router = useRouter(), { partition } = useLocal(), { connection } = useAuth();
  return !authEnvironment.connected ? <Notice>Circles are not connected yet. Your personal log still works offline.</Notice> : partition?.kind !== 'account' || !connection ? <><Copy>Sign in to join a small private group. Public sharing stays optional.</Copy><Button label="Sign in for circles" onPress={() => router.push('/auth')} /></> : null;
}
export function CircleNotice() {
  const { repository, retry } = useSync(), { refresh } = useLocal(), router = useRouter(); const pending = repository?.circles.pending();
  if (!pending) return null;
  return <><Notice error={pending.state === 'rejected'}>{pending.state === 'rejected' ? circleError(pending.code) : 'Your circle request is saved on this device and waiting for confirmation. Keep the app open when connected; retries use the same request.'}</Notice>
    {pending.state === 'rejected' ? <Button secondary label="Dismiss rejected circle request" onPress={() => { repository!.circles.discardRejected(); refresh(); }} /> : <Button secondary label="Retry circle request" onPress={retry} />}
    {['ACCOUNT_UNAVAILABLE', 'PARTICIPATION_REQUIRED'].includes(pending.code ?? '') && <Button secondary label="Review account participation" onPress={() => router.push('/sharing')} />}</>;
}
export function circleError(code?: string) {
  const messages: Record<string, string> = {
    PARTICIPATION_REQUIRED: 'Review your alias and accept current participation terms before creating or joining a circle.',
    CIRCLE_FULL: 'This circle has reached its 20-member limit.', CIRCLE_LIMIT: 'You can belong to five circles. Leave one before joining another.',
    INVITE_UNAVAILABLE: 'This invite is expired, revoked, or unavailable.', INVITE_LIMIT: 'This circle has five active invites. Revoke one before creating another.',
    MEMBERSHIP_CHANGED: 'Your membership changed. Open the circle list to check your current access.', NOT_FOUND_OR_FORBIDDEN: 'This circle or member is no longer available to your account.',
    OWNER_TRANSFER_REQUIRED: 'Transfer ownership before leaving, or delete your circle.', CIRCLE_NAME_REQUIRED: 'Choose a new circle name before inviting people.',
    INVALID_CIRCLE_NAME: 'Choose an available name with 3 to 40 characters.', RATE_LIMITED: 'Please wait. We will retry after the server pause.',
    ACCOUNT_UNAVAILABLE: 'Your account or participation needs attention. Review account settings.', UNAUTHENTICATED: 'Sign in again to check your circles.',
  }; return messages[code ?? ''] ?? 'Could not confirm this circle request. Check your connection and try again.';
}
export function CircleReadStatus({ state }: { state: CheckedState<unknown> }) {
  return state.status === 'offline' ? <Notice>Offline. Circle activity is hidden until current membership can be checked. Your personal log still works.</Notice> : state.status === 'error' ? <Notice error>{circleError(state.code)}</Notice> : state.status === 'loading' || state.status === 'waiting' ? <Copy>Checking current circle access…</Copy> : null;
}
