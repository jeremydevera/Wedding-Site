-- 0027: superadmin may DELETE support tickets (owner/anon cannot).
create policy support_superadmin_delete on public.support_tickets
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'superadmin'));
