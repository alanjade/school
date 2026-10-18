-- Apply the same current-term "current and past week only" cutoff to
-- PARENT visibility of curriculum topics/notes, mirroring what
-- 2026_07_28_student_week_visibility.sql did for students.
--
-- Run this AFTER 2026_07_28_student_week_visibility.sql (it depends on
-- topic_visible_to_student's new signature already existing, since
-- topic_note_visible calls both functions together).

begin;

-- 1. New signature: topic_visible_to_parent now takes the topic's own
--    academic_year/term/week_number, same shape as topic_visible_to_student.
create or replace function public.topic_visible_to_parent(
  t_education_level education_level,
  t_level_number integer,
  t_academic_year text,
  t_term integer,
  t_week_number integer
)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_current_academic_year text;
  v_current_term integer;
  v_current_week integer;
  v_has_child_at_level boolean;
begin
  select exists (
    select 1
    from guardian_links gl
    join student_profiles sp on sp.id = gl.student_id
    join classes c on c.id = sp.class_id
    where gl.parent_id = auth.uid()
      and c.education_level = t_education_level
      and c.level_number = t_level_number
  ) into v_has_child_at_level;

  if not v_has_child_at_level then
    return false;
  end if;

  select current_academic_year, current_term
    into v_current_academic_year, v_current_term
    from school_settings
    where id = 1;

  -- Past term: fully visible.
  if t_academic_year < v_current_academic_year
     or (t_academic_year = v_current_academic_year and t_term < v_current_term) then
    return true;
  end if;

  -- Current term: visible up to (and including) the current scheme week.
  if t_academic_year = v_current_academic_year and t_term = v_current_term then
    v_current_week := current_scheme_week();
    return t_week_number <= coalesce(v_current_week, t_week_number);
  end if;

  -- Future term: not yet visible.
  return false;
end;
$$;

-- 2. curriculum_topics RLS: pass the topic's own term/year/week columns
--    through to the updated function.
drop policy if exists topics_select_parent on curriculum_topics;
create policy topics_select_parent on curriculum_topics for select to public
  using (
    topic_visible_to_parent(
      education_level,
      level_number,
      academic_year,
      term,
      week_number
    )
  );

-- 3. topic_note_visible: update the topic_visible_to_parent call to match
--    its new signature (topic_visible_to_student side is already updated
--    by the previous migration).
create or replace function public.topic_note_visible(
  p_topic_id uuid,
  p_note_status note_status,
  p_author_id uuid
)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_education_level education_level;
  v_level_number integer;
  v_academic_year text;
  v_term integer;
  v_week_number integer;
begin
  if is_admin() or p_author_id = auth.uid() then
    return true;
  end if;

  if p_note_status <> 'published' then
    return false;
  end if;

  if exists (select 1 from teacher_profiles where id = auth.uid()) then
    return true;
  end if;

  select education_level, level_number, academic_year, term, week_number
    into v_education_level, v_level_number, v_academic_year, v_term, v_week_number
    from curriculum_topics
    where id = p_topic_id;

  return topic_visible_to_student(
           v_education_level, v_level_number, v_academic_year, v_term, v_week_number
         )
      or topic_visible_to_parent(
           v_education_level, v_level_number, v_academic_year, v_term, v_week_number
         );
end;
$$;

commit;
