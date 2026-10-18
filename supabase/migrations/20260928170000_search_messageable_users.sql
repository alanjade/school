-- messages_insert_sender lets any authenticated user message any other
-- user (no recipient restriction), but profiles' own SELECT policies
-- (profiles_select_own_or_admin / profiles_select_staff) only let a
-- caller read their own row, an admin read everyone, or a teacher read
-- everyone. A student or parent has no row-level access to anyone
-- else's profile at all, so the "+ New message" search in
-- NewConversationSearch.tsx -- which queries `profiles` straight from
-- the browser client -- silently returns zero results for every
-- student and parent, even though they're fully allowed to send the
-- message itself once a recipient id is known.
--
-- This is security definer (unlike search_topic_notes, which is
-- deliberately invoker) because the whole point is to expose a
-- narrow slice of *other people's* rows that the caller's own RLS
-- would otherwise hide. It only ever returns id/full_name/role --
-- never email, phone, or anything else profiles might hold -- so it
-- widens exactly as far as messages_insert_sender already does, and
-- no further.
create or replace function search_messageable_users(p_query text, p_limit integer default 10)
returns table(
  id uuid,
  full_name text,
  role text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.full_name, p.role::text
  from profiles p
  where p.id <> auth.uid()
    and p.full_name ilike '%' || p_query || '%'
  order by p.full_name
  limit greatest(least(p_limit, 50), 1);
$$;

grant execute on function search_messageable_users(text, integer) to authenticated;
