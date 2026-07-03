-- Prospect intake: submissions from the public /apply wizard await superadmin
-- approval before a client site is created. Rows are written only by the
-- site-request Edge Function (service role); superadmin reads/updates in the
-- console. No anon/owner access at all.
create table if not exists public.site_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending',           -- pending | approved | rejected
  email text not null,
  partner_a text not null,
  partner_b text not null,
  subdomain text not null,
  template_key text not null default 'classic',
  content jsonb not null default '{}'::jsonb        -- venue, map pin, schedule, entourage, strictRsvp
);

alter table public.site_requests enable row level security;

drop policy if exists "superadmin read site_requests" on public.site_requests;
create policy "superadmin read site_requests" on public.site_requests
  for select using (public.auth_role() = 'superadmin');

drop policy if exists "superadmin update site_requests" on public.site_requests;
create policy "superadmin update site_requests" on public.site_requests
  for update using (public.auth_role() = 'superadmin');

drop policy if exists "superadmin delete site_requests" on public.site_requests;
create policy "superadmin delete site_requests" on public.site_requests
  for delete using (public.auth_role() = 'superadmin');
