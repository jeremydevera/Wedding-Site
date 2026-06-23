-- Let an owner save their own client's site settings/content from the admin.
-- Scoped to their own client_id. The app only ever sends content / template_key /
-- event_type / theme (subdomain, is_active, owner_email aren't exposed in the owner
-- UI). Harden later with a column-restricted edge function if needed.
drop policy if exists "owner update client" on clients;
create policy "owner update client" on clients for update to authenticated
  using (id = public.auth_client())
  with check (id = public.auth_client());
