-- Let the superadmin read all submissions so the Overview dashboard can show
-- platform-wide counts (RSVPs / guestbook / quiz across every client).
drop policy if exists "superadmin read rsvps" on rsvps;
create policy "superadmin read rsvps" on rsvps for select using (public.auth_role() = 'superadmin');

drop policy if exists "superadmin read guestbook" on guestbook;
create policy "superadmin read guestbook" on guestbook for select using (public.auth_role() = 'superadmin');

drop policy if exists "superadmin read quiz" on quiz_answers;
create policy "superadmin read quiz" on quiz_answers for select using (public.auth_role() = 'superadmin');
