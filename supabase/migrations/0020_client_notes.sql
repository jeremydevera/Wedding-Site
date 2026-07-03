-- Superadmin-only freeform notes about a client. Kept in a separate table (NOT a
-- clients column) because clients has a public "read active clients" SELECT
-- policy — anything on that row is readable via the anon key. Notes must stay
-- private, so this table grants no anon/owner access at all: superadmin only.
create table if not exists public.client_notes (
  client_id uuid primary key references public.clients(id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.client_notes enable row level security;

drop policy if exists "superadmin manage client_notes" on public.client_notes;
create policy "superadmin manage client_notes" on public.client_notes
  for all to authenticated
  using (public.auth_role() = 'superadmin')
  with check (public.auth_role() = 'superadmin');
