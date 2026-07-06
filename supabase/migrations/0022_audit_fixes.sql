-- 0022_audit_fixes.sql — forward fixes from the security/correctness audit.
-- Covers #42 (owner column-privilege lock) and #32 (duplicate pending site requests).

-- ---------------------------------------------------------------------------
-- #42  Owner may edit only their OWN client's content/theme, NOT the sensitive
-- columns (is_active, subdomain, owner_email). The "owner update client" RLS
-- policy (0006) only checks id = auth_client() with no column restriction, so an
-- owner using the anon/authenticated key directly could deactivate their site,
-- squat a new subdomain, or spoof the owner_email the superadmin console trusts.
-- RLS can't express column-level rules on UPDATE, so enforce with a trigger.
-- Guard applies ONLY to real authenticated non-superadmin callers: auth.uid() is
-- null for the service role (trusted backend / edge functions) and for anon
-- (which RLS blocks from updating anyway), so those paths are unaffected.
create or replace function public.lock_client_admin_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.auth_role() is distinct from 'superadmin' then
    if new.is_active   is distinct from old.is_active
    or new.subdomain   is distinct from old.subdomain
    or new.owner_email is distinct from old.owner_email then
      raise exception 'owners may not change is_active, subdomain, or owner_email'
        using errcode = '42501'; -- insufficient_privilege
    end if;
  end if;
  return new;
end; $$;
revoke execute on function public.lock_client_admin_columns() from anon, authenticated, public;

drop trigger if exists lock_client_admin_columns_trg on public.clients;
create trigger lock_client_admin_columns_trg
  before update on public.clients
  for each row execute function public.lock_client_admin_columns();

-- ---------------------------------------------------------------------------
-- #32  Two concurrent /apply submissions for the same subdomain both pass the
-- isFree() pre-check and both insert a pending request. A partial unique index
-- makes the second insert fail (23505), which the site-request Edge Function now
-- maps to a 409. Only one PENDING request per subdomain; approved/rejected rows
-- are unconstrained so a subdomain can be re-requested after a rejection.
create unique index if not exists site_requests_pending_subdomain_uniq
  on public.site_requests (lower(subdomain))
  where status = 'pending';
