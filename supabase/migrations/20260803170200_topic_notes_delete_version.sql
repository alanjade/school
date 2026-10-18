-- topic_notes never had a DELETE policy at all -- RLS defaults to
-- deny-everything for any action with no matching policy, so a version
-- could not be deleted by anyone (author, admin, or otherwise) even
-- though SELECT/UPDATE/INSERT were already scoped. Needed for the new
-- "delete a version" action in the version-history panel.
--
-- Scoped the same as notes_update_own_or_admin: the note's author, an
-- admin, or a teacher who currently teaches that topic's subject (covers
-- a HOD/co-teacher cleaning up a colleague's old draft on a subject they
-- share responsibility for) -- not opened up any wider than editing
-- already was.
create policy notes_delete_own_or_admin on topic_notes for delete to public
  using (is_admin() or author_id = auth.uid() or exists (
    select 1 from curriculum_topics ct join teacher_profiles tp on tp.id = auth.uid()
    where ct.id = topic_notes.topic_id and ct.subject_id = any(tp.subjects_taught)));
