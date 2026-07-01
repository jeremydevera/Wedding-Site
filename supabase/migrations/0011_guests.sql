-- Owner-managed invited-guest list with a per-guest seat allocation. Owner-only
-- (RLS) — never exposed to anon, so it can't be read from the public site. Used
-- by the admin "Guests" tab to reconcile against RSVPs (who replied, headcount).
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  middle_name text,
  allocation int not null default 1,
  email text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists guests_client_id_idx on public.guests(client_id);

alter table public.guests enable row level security;

drop policy if exists "owner manage guests" on public.guests;
create policy "owner manage guests" on public.guests for all to authenticated
  using (client_id = public.auth_client()) with check (client_id = public.auth_client());

drop policy if exists "superadmin manage guests" on public.guests;
create policy "superadmin manage guests" on public.guests for all to authenticated
  using (public.auth_role() = 'superadmin') with check (public.auth_role() = 'superadmin');
