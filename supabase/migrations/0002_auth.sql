-- Auto-create a profile (default role 'guest') whenever an auth user is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role) values (new.id, 'guest')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Helpers to read the caller's role/client without RLS recursion.
create or replace function public.auth_role()
returns text language sql security definer stable set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.auth_client()
returns uuid language sql security definer stable set search_path = public as $$
  select client_id from public.profiles where id = auth.uid()
$$;

-- Profiles: superadmin can read all (own-profile select policy already exists).
drop policy if exists "superadmin read profiles" on profiles;
create policy "superadmin read profiles" on profiles
  for select using (public.auth_role() = 'superadmin');

-- Clients: superadmin full write (anon "read active clients" select policy already exists).
drop policy if exists "superadmin manage clients" on clients;
create policy "superadmin manage clients" on clients
  for all using (public.auth_role() = 'superadmin')
  with check (public.auth_role() = 'superadmin');
