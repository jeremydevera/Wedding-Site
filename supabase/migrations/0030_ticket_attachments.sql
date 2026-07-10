-- Support ticket image attachments (one image per message).
-- Owners attach a screenshot when filing a ticket and on replies; superadmin
-- attaches on replies. The value is a BARE R2 key (uploaded via /api/upload,
-- rendered with mediaUrl()). Nullable — most tickets/replies have no image.
alter table public.support_tickets         add column if not exists attachment_url text;
alter table public.support_ticket_messages add column if not exists attachment_url text;
