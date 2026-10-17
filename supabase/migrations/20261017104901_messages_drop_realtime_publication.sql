-- Messaging no longer uses Supabase Realtime: the inbox, open threads and
-- sidebar badge poll server actions instead (see lib/messagePolling.ts).
-- Nothing subscribes to `messages` any more, so take it out of the
-- supabase_realtime publication and stop the database doing change-capture
-- work for a table nobody listens to.
--
-- Only `messages` is removed. Other tables in the publication (e.g.
-- transport_trip_status, used by TransportStatusBadge and RouteMap) are
-- untouched.
--
-- This was originally applied directly to the live project as
-- `messages_drop_realtime_publication` (version 20261017104901); this file
-- exists so the repo reproduces the database. It is guarded because
-- `alter publication ... drop table` raises an error when the table isn't a
-- member, which is the normal state of a freshly built database, and so
-- that re-running it is harmless.
--
-- To undo: alter publication supabase_realtime add table public.messages;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime drop table public.messages;
  end if;
end
$$;
