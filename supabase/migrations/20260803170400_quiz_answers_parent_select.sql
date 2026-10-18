-- Parents can already read their child's quiz_attempts (is_parent_of on
-- quiz_attempts_select), but quiz_answers_select never got the same grant.
-- This mostly went unnoticed because grades_select_parent already gates on
-- moderation_status = 'approved', so a parent can't see a quiz's score at
-- all until an HOD/admin approves the whole assessment.
--
-- But approveAssessmentGrades() approves every pending grade for an
-- assessment in bulk, regardless of whether each student's essay
-- questions have been individually graded yet -- so a bulk approval can
-- surface an approved grade whose underlying quiz still has an ungraded
-- essay answer. The parent/student grades pages defend against that by
-- checking quiz_answers for a still-null points_awarded on an essay
-- question, but that check silently returns nothing for a parent without
-- this grant, so the defense never actually fires for them.
drop policy if exists quiz_answers_select on quiz_answers;

create policy quiz_answers_select on quiz_answers for select to public
  using (
    is_admin()
    or exists (
      select 1 from quiz_attempts qa
      where qa.id = quiz_answers.attempt_id
        and (
          is_self_student(qa.student_id)
          or is_parent_of(qa.student_id)
          or is_quiz_owner(qa.quiz_id)
          or can_grade_quiz(qa.quiz_id)
        )
    )
  );
