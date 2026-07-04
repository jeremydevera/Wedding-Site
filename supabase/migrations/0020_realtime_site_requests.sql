-- 0020: Realtime for the superadmin console bell — publish site_requests so a
-- new /apply submission pushes to the console without a refresh. Delivery is
-- RLS-gated: only the superadmin's select policy passes, so nobody else can
-- subscribe to the intake queue.
alter publication supabase_realtime add table public.site_requests;
