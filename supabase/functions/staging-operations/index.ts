import { operationsHandler } from '../../../tools/backend/scripts/operations-handler.mjs';

// No request-supplied target, credentials, user IDs, SQL or operations are accepted.
Deno.serve(operationsHandler({
  DELETION_API_URL: Deno.env.get('DELETION_API_URL'),
  DELETION_DATABASE_URL: Deno.env.get('DELETION_DATABASE_URL'),
  DELETION_ADMIN_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  OPERATIONS_CRON_SECRET: Deno.env.get('OPERATIONS_CRON_SECRET'),
  OPERATIONS_HEARTBEAT_URL: Deno.env.get('OPERATIONS_HEARTBEAT_URL'),
}));
