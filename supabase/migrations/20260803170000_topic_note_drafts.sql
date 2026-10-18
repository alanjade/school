-- Periodic autosave scratch space for topic notes (#13 of
-- markdown-editor-todo.md, "remaining" list).
--
-- Deliberately NOT another row in `topic_notes`: that table is
-- append-only (every explicit Save Draft / Publish inserts a new
-- `version`, by design -- see saveTopicNote's comment in
-- lib/actions/teacher.ts), so a periodic autosave writing there every
-- ~15s would flood a note's version history with junk rows and make
-- the version-diff feature (#14, NoteVersionDiff.tsx) useless -- every
-- comparison would be against an autosave tick, not a real save.
--
-- This table is a single scratch row per (topic, author): each autosave
-- tick UPSERTs onto the same row rather than inserting a new one, and a
-- row is deleted the moment its content is superseded by a real
-- saveTopicNote() call (see clearTopicNoteDraft in teacher.ts) so it
-- never lingers as stale "recoverable" content once the real save
-- already covers it.
create table topic_note_drafts (
  topic_id uuid not null references curriculum_topics(id),
  author_id uuid not null references profiles(id),
  content text not null,
  updated_at timestamp with time zone not null default now(),
  constraint topic_note_drafts_pkey primary key (topic_id, author_id)
);

alter table topic_note_drafts enable row level security;

-- Purely a personal scratchpad -- no HOD/admin visibility needed the way
-- topic_notes has, since nothing here is ever shown to anyone but the
-- teacher who's mid-edit. Ownership is checked the same way
-- notes_write_teacher_admin does for topic_notes itself.
create policy note_drafts_own on topic_note_drafts for all to public
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from curriculum_topics ct join teacher_profiles tp on tp.id = auth.uid()
      where ct.id = topic_note_drafts.topic_id and ct.subject_id = any(tp.subjects_taught)
    )
  );
