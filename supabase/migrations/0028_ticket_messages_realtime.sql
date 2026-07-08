-- 0028: ticket replies push over realtime (bell + live threads). RLS SELECT
-- policies gate delivery: owners only receive their own ticket's messages.
alter publication supabase_realtime add table public.support_ticket_messages;
