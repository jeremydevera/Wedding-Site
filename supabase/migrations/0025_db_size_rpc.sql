-- 0025_db_size_rpc.sql
-- Superadmin Health tab: expose the database's total size so the console can
-- show usage against the Supabase free-tier 500 MB cap. SECURITY DEFINER is
-- required (pg_database_size needs elevated rights), so the function itself
-- re-checks the caller: only a profiles.role = 'superadmin' JWT gets a number;
-- everyone else (anon, owners, guests) gets NULL — fail closed, no size leak.
create or replace function public.db_size_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'superadmin'
    )
    then pg_database_size(current_database())
    else null
  end;
$$;

revoke all on function public.db_size_bytes() from public;
revoke all on function public.db_size_bytes() from anon;
grant execute on function public.db_size_bytes() to authenticated;
