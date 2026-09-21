import { pathToFileURL } from 'node:url';

export function validateStaging(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Staging deployment requires a manual run on main.');
  }
  if (env.SUPABASE_PROJECT_ID !== 'ggeyfolfedercmfvwsqx') {
    throw new Error('SUPABASE_PROJECT_ID must match the approved staging project.');
  }
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']) {
    if (!env[name]?.trim()) throw new Error(`Missing staging environment secret: ${name}`);
  }
  if (!['preview', 'apply'].includes(env.DEPLOY_MODE)) throw new Error('Invalid deployment mode.');
  if (env.DEPLOY_MODE === 'apply' &&
      (!/^[a-f0-9]{40}$/.test(env.REVIEWED_SHA ?? '') || env.REVIEWED_SHA !== env.GITHUB_SHA)) {
    throw new Error('Apply requires the full commit SHA from the reviewed preview, matching this run.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateStaging(process.env);
    console.log('Staging target and deployment inputs validated.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
