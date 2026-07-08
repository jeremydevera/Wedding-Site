-- 0026_support_tickets.sql
-- Client support tickets: a logged-in owner files a help ticket from their admin
-- console (sticky agent widget); the superadmin lists + resolves them. RLS scopes
-- an owner to their OWN client's tickets (insert + read); the superadmin sees and
-- updates all. Anon has no access. Added to the realtime publication so the
-- console bell pings on new tickets (same pattern as site_requests).

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid not null references public.clients(id) on delete cascade,
  submitter_email text,
  submitter_name text,
  subject text not null,
  category text not null default 'Question',
  urgency text not null default 'Normal',
  message text not null,
  context_url text,
  status text not null default 'open',
  admin_note text,
  resolved_at timestamptz
);

create index if not exists support_tickets_client_idx on public.support_tickets(client_id);
create index if not exists support_tickets_status_idx on public.support_tickets(status);

alter table public.support_tickets enable row level security;

-- Helper predicates inline (no SECURITY DEFINER needed — profiles is readable by
-- the owning user under its own RLS; we only read auth.uid()'s own row).
-- Owner: may INSERT a ticket for their own client, and SELECT their own client's.
create policy support_owner_insert on public.support_tickets
  for insert to authenticated
  with check (
    client_id = (select p.client_id from public.profiles p where p.id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  );

create policy support_owner_select on public.support_tickets
  for select to authenticated
  using (
    client_id = (select p.client_id from public.profiles p where p.id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin')
  );

-- Superadmin: full UPDATE (status / admin_note / resolved_at). Owners cannot
-- change status or edit another client's ticket.
create policy support_superadmin_update on public.support_tickets
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin'));

-- Realtime for the superadmin console bell.
alter publication supabase_realtime add table public.support_tickets;
