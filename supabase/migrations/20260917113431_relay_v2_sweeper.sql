-- Scheduled physical deletion, including when every browser is closed.
-- No secret in cron commands, URLs, database settings, or migration history.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('relay-v2-expiry','* * * * *', $job$
  select net.http_post(
    url := 'https://gvuuiazenabtsbmozrbk.supabase.co/functions/v1/relay-v2/sweep',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$job$);
