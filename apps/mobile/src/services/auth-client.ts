import 'react-native-url-polyfill/auto';
import { createClient, processLock } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ChunkStore } from '../data/auth/chunk-store';
import { readEnvironment } from '../config/environment';

export const authEnvironment = readEnvironment({ EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV, EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
// Web preview deliberately keeps session material in memory, never localStorage.
const memory = new Map<string, string>();
export const sessionStore = new ChunkStore(Platform.OS === 'web' ? {
  getItem: async key => memory.get(key) ?? null,
  setItem: async (key, value) => { memory.set(key, value); },
  removeItem: async key => { memory.delete(key); },
} : {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  removeItem: key => SecureStore.deleteItemAsync(key),
});

export function makeAuthClient() {
  if (!authEnvironment.connected) return null;
  let live = true;
  const client = createClient(authEnvironment.url!, authEnvironment.key!, { auth: {
    storageKey: 'pushupclub.auth', persistSession: true, autoRefreshToken: false,
    detectSessionInUrl: false, lock: processLock,
    storage: {
      getItem: key => live ? sessionStore.getItem(key) : Promise.resolve(null),
      setItem: (key, value) => live ? sessionStore.setItem(key, value) : Promise.resolve(),
      removeItem: key => live ? sessionStore.removeItem(key) : Promise.resolve(),
    },
  } });
  return { client, dispose: () => { live = false; void client.auth.stopAutoRefresh(); void client.removeAllChannels(); } };
}
