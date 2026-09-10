export type Environment = 'development' | 'preview' | 'production';

export function readEnvironment(values: Record<string, string | undefined>) {
  const name = values.EXPO_PUBLIC_APP_ENV ?? 'development';
  if (!['development', 'preview', 'production'].includes(name)) throw new Error('Invalid APP_ENV');
  const url = values.EXPO_PUBLIC_SUPABASE_URL;
  const key = values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!!url !== !!key) throw new Error('Provide both Supabase URL and publishable key');
  const localDevelopment = name === 'development' && !!url && /^http:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2):54321\/?$/.test(url);
  if (url && !localDevelopment && !/^https:\/\/[a-z0-9.-]+\/?$/i.test(url)) throw new Error('Supabase URL must use HTTPS');
  if (name === 'production' && (!url || !key || /example|placeholder|localhost/i.test(url + key))) {
    throw new Error('Production requires configured services');
  }
  return { name: name as Environment, connected: !!(url && key), url, key };
}
