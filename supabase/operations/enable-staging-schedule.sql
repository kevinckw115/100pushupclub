-- Run only in the approved staging project's SQL Editor, after function/secrets setup.
-- No token is embedded in this file or in the stored cron command.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if (select count(*) from vault.decrypted_secrets where name='operations_cron_secret' and decrypted_secret ~ '^[a-f0-9]{64}$') <> 1 then
    raise exception 'Create exactly one operations_cron_secret in Vault first';
  end if;
end;
$$;
select cron.schedule(
  '100pushupclub-staging-operations',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://ggeyfolfedercmfvwsqx.supabase.co/functions/v1/staging-operations',
      headers := jsonb_build_object('Content-Type','application/json','x-operations-key',
        (select decrypted_secret from vault.decrypted_secrets where name='operations_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
