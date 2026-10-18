-- Lesson Plan approval (HOD workflow) for curriculum notes.
--
-- topic_notes.status (draft/published/archived) is a *publishing* state,
-- not a moderation gate -- there was no way for a subject's HOD to review
-- and approve a note before students/parents could see it, unlike grades
-- (grades.moderation_status). This adds the same shape to topic_notes.

begin;

-- Plain text + check constraint, not an enum -- mirrors grades'
-- moderation_status column exactly, and sidesteps the "ALTER TYPE ADD
-- VALUE can't run in the same transaction as anything referencing the
-- new value" pitfall already hit once during the librarian staff_role
-- rollout (see todo.md).
-- Idempotent guards: if a previous partial run of this migration got far
-- enough to add the column/constraint before failing on the DROP
-- FUNCTION step below, a straight rerun would otherwise error out on
-- "column already exists" before ever reaching the actual fix.
alter table public.topic_notes
  add column if not exists moderation_status text not null default 'approved';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'topic_notes_moderation_status_check'
      and conrelid = 'public.topic_notes'::regclass
  ) then
    alter table public.topic_notes
      add constraint topic_notes_moderation_status_check
      check (moderation_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- Existing rows default to 'approved' so nothing that was already
-- visible under the old (status-only) rule silently disappears. Only
-- *newly published* notes from here on get routed through the pending
-- state -- see saveTopicNote()'s updated logic in lib/actions/teacher.ts.

-- Helper: is the current user the HOD for the subject this topic belongs
-- to? Used by both the updated visibility function below (a HOD needs to
-- see pending/rejected notes to act on them, not just approved ones) and
-- the new update policy (so they can actually record a decision).
create or replace function public.is_hod_of_topic(p_topic_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from curriculum_topics ct
    where ct.id = p_topic_id
      and is_hod_of_subject(ct.subject_id)
  );
$$;

-- topic_note_visible() gains a 4th parameter. Per the
-- 2026_07_29_drop_orphaned_visibility_overloads.sql lesson: CREATE OR
-- REPLACE with a changed argument list leaves the OLD signature behind
-- as an orphan rather than replacing it, so the 3-arg version has to be
-- dropped explicitly first, in the same transaction as creating the
-- 4-arg replacement and repointing the policies that call it.
--
-- Two policies depend on the 3-arg signature, not just one:
-- topic_notes.notes_select_scoped AND topic_resources.resources_select_scoped
-- (the latter calls it for the note a resource is attached to). Postgres
-- won't let the function be dropped while either still references it, so
-- both have to go first.
drop policy if exists notes_select_scoped on public.topic_notes;
drop policy if exists resources_select_scoped on public.topic_resources;
drop function if exists public.topic_note_visible(uuid, note_status, uuid);

create or replace function public.topic_note_visible(
  p_topic_id uuid,
  p_note_status note_status,
  p_author_id uuid,
  p_moderation_status text
)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_education_level education_level;
  v_level_number integer;
  v_academic_year text;
  v_term integer;
  v_week_number integer;
BEGIN
  IF is_admin() OR p_author_id = auth.uid() THEN
    RETURN true;
  END IF;

  -- A subject's HOD can see every note for that subject regardless of
  -- moderation state -- that's the point of the review workflow: they
  -- need to see pending (and rejected, to check a resubmission) notes
  -- to act on them, not just the ones already approved.
  IF is_hod_of_topic(p_topic_id) THEN
    RETURN true;
  END IF;

  IF p_note_status <> 'published' OR p_moderation_status <> 'approved' THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM teacher_profiles WHERE id = auth.uid()) THEN
    RETURN true;
  END IF;

  -- topic_visible_to_student/parent take the 5-arg (level + week-of-term)
  -- signature added by the student/parent week-visibility migrations --
  -- this has to stay in sync with whatever that pair currently expects,
  -- not the older 2-arg (level-only) shape.
  SELECT education_level, level_number, academic_year, term, week_number
    INTO v_education_level, v_level_number, v_academic_year, v_term, v_week_number
    FROM curriculum_topics
    WHERE id = p_topic_id;

  RETURN topic_visible_to_student(
           v_education_level, v_level_number, v_academic_year, v_term, v_week_number
         )
      OR topic_visible_to_parent(
           v_education_level, v_level_number, v_academic_year, v_term, v_week_number
         );
END;
$function$;

-- Repoint the SELECT policies at the new 4-arg signature (both were
-- dropped above, before the function drop, since Postgres won't drop a
-- function while a policy still depends on it).
drop policy if exists notes_select_scoped on public.topic_notes;
create policy notes_select_scoped on public.topic_notes for select to public
  using (topic_note_visible(topic_id, status, author_id, moderation_status));

drop policy if exists resources_select_scoped on public.topic_resources;
create policy resources_select_scoped on public.topic_resources for select to public
  using (
    (note_id is not null and exists (
      select 1 from topic_notes n
      where n.id = topic_resources.note_id
        and topic_note_visible(n.topic_id, n.status, n.author_id, n.moderation_status)))
    or note_id is null
  );

-- New: a subject's HOD can update a note to record an approve/reject
-- decision. RLS can't restrict this to just the moderation_status column
-- -- app code (approveLessonPlan/rejectLessonPlan in
-- lib/actions/lessonPlanModeration.ts) is what actually limits which
-- field gets touched, same caveat as notes_update_hod's sibling
-- grades_update_hod already has for grades.
drop policy if exists notes_update_hod on public.topic_notes;
create policy notes_update_hod on public.topic_notes for update to public
  using (is_hod_of_topic(topic_id))
  with check (is_hod_of_topic(topic_id));

commit;