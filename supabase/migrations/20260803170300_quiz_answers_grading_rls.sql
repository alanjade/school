-- Fixes a read/write authorization mismatch on quiz_answers (and, as it
-- turns out, on quizzes/quiz_questions/quiz_options too -- see below).
--
-- grade_quiz_essay_answers() authorizes any teacher whose subjects_taught
-- includes the quiz's subject (or an admin) to grade essay answers -- it
-- does its own explicit check and runs as security definer, so it isn't
-- gated by RLS at all. But quiz_answers_select (the RLS policy governing
-- plain SELECTs, which the teacher UI's essay-answer query relies on)
-- only allows the quiz's *creator* (is_quiz_owner, i.e. created_by =
-- auth.uid()) or the student themselves or an admin.
--
-- Net effect: a teacher who shares the quiz's subject but didn't create
-- it can successfully call grade_quiz_essay_answers (the RPC has its own
-- authorization), but can't SELECT the answer_text to grade in the first
-- place -- the teacher UI's "essay answers awaiting grading" query comes
-- back empty for them, RLS-filtered out silently rather than erroring,
-- so the essay just doesn't appear at all. Only the original creator
-- could ever see it.
--
-- It's actually worse than just the answers: quizzes_select,
-- quiz_questions_select_staff, quiz_options_select_staff, and
-- quiz_attempts_select all have the identical is_admin()-or-
-- is_quiz_owner()-only gate. A co-teacher who shares the subject can't
-- even load /dashboard/teacher/quizzes/[id] at all -- quizzes_select
-- denies them first, so the whole page comes back "Quiz not found," not
-- just a missing essay answer; and even if that were fixed alone,
-- quiz_attempts_select would still hide the attempts list itself, so
-- there'd be nothing to click "grade" on.
--
-- Fix: give all four policies the same subject-based authorization
-- grade_quiz_essay_answers already uses, via a new can_grade_quiz()
-- helper mirroring that RPC's exact check.
create or replace function can_grade_quiz(qid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from quizzes q
    join assessments a on a.id = q.assessment_id
    join teacher_profiles tp on tp.id = auth.uid()
    where q.id = qid and a.subject_id = any(tp.subjects_taught)
  );
$$;

drop policy if exists quiz_answers_select on quiz_answers;

create policy quiz_answers_select on quiz_answers for select to public
  using (
    is_admin()
    or exists (
      select 1 from quiz_attempts qa
      where qa.id = quiz_answers.attempt_id
        and (is_self_student(qa.student_id) or is_quiz_owner(qa.quiz_id) or can_grade_quiz(qa.quiz_id))
    )
  );

drop policy if exists quizzes_select on quizzes;

create policy quizzes_select on quizzes for select to public
  using (
    is_admin() or is_quiz_owner(id) or can_grade_quiz(id)
    or (is_published and exists (
      select 1 from assessments a join student_profiles sp on sp.class_id = a.class_id
      where a.id = quizzes.assessment_id and sp.id = auth.uid()))
  );

drop policy if exists quiz_questions_select_staff on quiz_questions;

create policy quiz_questions_select_staff on quiz_questions for select to public
  using (is_admin() or is_quiz_owner(quiz_id) or can_grade_quiz(quiz_id));

drop policy if exists quiz_options_select_staff on quiz_options;

create policy quiz_options_select_staff on quiz_options for select to public
  using (
    is_admin()
    or exists (
      select 1 from quiz_questions qq
      where qq.id = quiz_options.question_id
        and (is_quiz_owner(qq.quiz_id) or can_grade_quiz(qq.quiz_id))
    )
  );

drop policy if exists quiz_attempts_select on quiz_attempts;

create policy quiz_attempts_select on quiz_attempts for select to public
  using (
    is_self_student(student_id)
    or is_parent_of(student_id)
    or is_admin()
    or is_quiz_owner(quiz_id)
    or can_grade_quiz(quiz_id)
  );
