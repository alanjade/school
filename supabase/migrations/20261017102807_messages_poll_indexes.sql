-- Messaging polls instead of using Supabase Realtime (see
-- lib/messagePolling.ts), so `messages` is now read every few seconds by
-- every open thread, inbox and sidebar badge. Until now it had no indexes
-- beyond its primary key, so each of those reads was a sequential scan.
--
-- Thread poll / thread page:  (sender_id, recipient_id) pair + sent_at
--   -> served by either of the two indexes below (one per OR branch).
-- Inbox:                      sender_id = me OR recipient_id = me
--   -> same two indexes (BitmapOr).
-- Sidebar badge:              recipient_id = me AND read = false
--   -> the partial index, which stays tiny because rows leave it as
--      soon as they're read.

create index if not exists messages_recipient_sent_idx
  on messages (recipient_id, sent_at desc);

create index if not exists messages_sender_sent_idx
  on messages (sender_id, sent_at desc);

create index if not exists messages_unread_idx
  on messages (recipient_id)
  where read = false;
