-- Per-account send log backing the /api/send-email rate limit. One row per email
-- sent; the Function counts a caller's rows in the last hour and refuses over the
-- cap. RLS: a user only ever sees/writes their own rows (the Function calls with
-- the caller's token), so this can't be used to read anyone else's activity.
create table if not exists public.email_send_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index if not exists email_send_log_user_time on public.email_send_log (user_id, sent_at desc);

alter table public.email_send_log enable row level security;

drop policy if exists "own email log insert" on public.email_send_log;
create policy "own email log insert" on public.email_send_log
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "own email log read" on public.email_send_log;
create policy "own email log read" on public.email_send_log
  for select to authenticated using (auth.uid() = user_id);
