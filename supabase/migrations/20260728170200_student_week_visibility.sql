-- Restrict STUDENT visibility of curriculum topics (and, by extension,
-- topic_notes / topic_resources) to:
--   - any topic in a term that has already ended, OR
--   - a topic in the CURRENT term whose week_number is <= the current
--     scheme week (school_settings.current_scheme_week()).
-- Future weeks in the current term, and any future term, are hidden.
--
-- Teachers/admins are unaffected (topics_select_staff, is_admin() checks
-- in topic_note_visible are untouched). Parent visibility is unchanged —
-- topic_visible_to_parent() keeps its original signature/behavior.
--
-- NOTE on current_scheme_week(): if school_settings.current_term_start_date
-- is NULL, current_scheme_week() returns NULL. This migration fails OPEN
-- in that case (treats every week as visible) rather than locking students
-- out entirely — flag if you'd prefer fail-closed instead.
--
-- NOTE on cross-year "past term" comparison: this assumes academic_year
-- strings sort correctly as text (e.g. '2024/2025' < '2025/2026'). If your
-- academic_year format doesn't sort lexicographically in chronological
-- order, that branch needs adjusting.

begin;

-- 1. New signature: topic_visible_to_student now takes the topic's
--    academic_year/term/week_number so it can apply the cutoff.
create or replace function public.topic_visible_to_student(
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
  v_is_own_level boolean;
begin
  select exists (
    select 1
    from student_profiles sp
    join classes c on c.id = sp.class_id
    where sp.id = auth.uid()
      and c.education_level = t_education_level
      and c.level_number = t_level_number
  ) into v_is_own_level;

  if not v_is_own_level then
    return false;
  end if;

  select current_academic_year, current_term
    into v_current_academic_year, v_current_term
    from school_settings
    where id = 1;

  -- Past term (earlier year, or same year earlier term): fully visible.
  if t_academic_year < v_current_academic_year
     or (t_academic_year = v_current_academic_year and t_term < v_current_term) then
    return true;
  end if;

  -- Current term: visible up to (and including) the current scheme week.
  if t_academic_year = v_current_academic_year and t_term = v_current_term then
    v_current_week := current_scheme_week();
    return t_week_number <= coalesce(v_current_week, t_week_number);
  end if;

  -- Anything else (a future term) is not yet visible.
  return false;
end;
$$;

-- 2. curriculum_topics RLS: pass the topic's own term/year/week columns
--    through to the updated function.
drop policy if exists topics_select_student on curriculum_topics;
create policy topics_select_student on curriculum_topics for select to public
  using (
    topic_visible_to_student(
      education_level,
      level_number,
      academic_year,
      term,
      week_number
    )
  );

-- 3. topic_note_visible: fetch the extra columns and pass them through too.
--    (topic_visible_to_parent signature/behavior is unchanged.)
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
      or topic_visible_to_parent(v_education_level, v_level_number);
end;
$$;

commit;
