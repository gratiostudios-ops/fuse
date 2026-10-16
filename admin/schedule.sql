-- Run once using trusted Supabase administration AFTER configuring Vault secrets
-- fuse_catalog_worker_url and fuse_catalog_worker_secret. Requires Cron, pg_net, Vault.
-- Rerunnable; replaces only this job. The tick processes one persisted batch, not
-- a full discovery run. The database enforces the actual 72-hour discovery cadence.
do $$ declare job bigint; begin
  for job in select jobid from cron.job where jobname='fuse-catalog-worker-tick' loop
    perform cron.unschedule(job);
  end loop;
end $$;
select cron.schedule('fuse-catalog-worker-tick', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='fuse_catalog_worker_url'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='fuse_catalog_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
$job$);
