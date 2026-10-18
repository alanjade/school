-- Full-text search across curriculum note content. topic_notes.content
-- has been growing per-topic with no way to find something across
-- topics/subjects other than clicking through the curriculum tree one
-- topic at a time.
--
-- content_search is a generated column (kept in sync automatically by
-- Postgres on every insert/update, no trigger needed) so the GIN index
-- below is usable without a full table scan.

alter table topic_notes
  add column if not exists content_search tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists topic_notes_content_search_idx
  on topic_notes using gin (content_search);

-- search_topic_notes: deliberately NOT security definer -- it runs as
-- the calling user, so topic_notes' own notes_select_scoped RLS policy
-- (topic_note_visible: author, HOD, admin, or published+approved+in a
-- visible week for that role) applies exactly as it would to a plain
-- SELECT. A student can never search up a draft or a note outside their
-- visible weeks this way, and nothing here needs to duplicate that
-- policy's logic.
--
-- curriculum_topics/subjects are left-joined rather than inner-joined:
-- both have their own RLS (also week-gated for students), and if a topic
-- row were ever invisible to a viewer whose topic_notes row *is*
-- visible, an inner join would silently drop the whole result instead
-- of just losing the title/subject label.
create or replace function search_topic_notes(p_query text, p_limit integer default 20)
returns table(
  note_id uuid,
  topic_id uuid,
  topic_title text,
  subject_name text,
  snippet text,
  rank real
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    n.id,
    n.topic_id,
    t.title,
    s.name,
    ts_headline(
      'english', n.content, websearch_to_tsquery('english', p_query),
      -- Delimiters are control characters, not HTML tags: note content is
      -- teacher-authored free text, not sanitized markup, so the client
      -- splits on these markers and renders <mark> itself via React
      -- rather than ever dangerouslySetInnerHTML-ing text that came from
      -- a note body. chr(1)/chr(2) (concatenated, not escaped inline) so
      -- this isn't relying on standard_conforming_strings behavior.
      'MaxFragments=1, MaxWords=25, MinWords=10, StartSel=' || chr(1) || ', StopSel=' || chr(2)
    ),
    ts_rank(n.content_search, websearch_to_tsquery('english', p_query))
  from topic_notes n
  left join curriculum_topics t on t.id = n.topic_id
  left join subjects s on s.id = t.subject_id
  where n.content_search @@ websearch_to_tsquery('english', p_query)
  order by ts_rank(n.content_search, websearch_to_tsquery('english', p_query)) desc
  limit greatest(least(p_limit, 50), 1);
$$;

grant execute on function search_topic_notes(text, integer) to authenticated;
