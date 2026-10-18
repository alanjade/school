-- Quiz result review for students.
--
-- get_quiz_attempt_questions (used while an attempt is in progress)
-- deliberately never exposes quiz_options.is_correct or
-- quiz_answers.points_awarded -- that's an answer key, and a student
-- reading it out of the network tab mid-attempt would defeat the quiz.
-- That's still correct for in-progress attempts, but it means there's
-- currently no way for a student to see which answers they got wrong
-- once they're done -- quiz_attempts.score is all they get.
--
-- This adds a separate RPC, gated on submitted_at being set, that
-- returns the same per-question/option shape plus is_correct and
-- points_awarded so a finished attempt can be reviewed properly.

create or replace function get_quiz_attempt_review(p_attempt_id uuid)
returns table(
  question_id uuid,
  question_text text,
  question_type text,
  points numeric,
  question_sequence integer,
  option_id uuid,
  option_text text,
  is_correct boolean,
  match_prompt text,
  option_sequence integer,
  selected_option_id uuid,
  answer_text text,
  matched_pairs jsonb,
  points_awarded numeric
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_attempt quiz_attempts;
begin
  select * into v_attempt from quiz_attempts where id = p_attempt_id;
  if v_attempt.id is null then
    raise exception 'Attempt not found.';
  end if;

  if v_attempt.submitted_at is null then
    raise exception 'This attempt has not been submitted yet.';
  end if;

  -- Same viewer set as quiz_attempts_select: the student themselves, a
  -- parent, an admin, or a teacher authorized to grade/own this quiz --
  -- so a teacher reviewing a submission sees the same shape a student
  -- would, correct answers included.
  if not (
    is_self_student(v_attempt.student_id)
    or is_parent_of(v_attempt.student_id)
    or is_admin()
    or is_quiz_owner(v_attempt.quiz_id)
    or can_grade_quiz(v_attempt.quiz_id)
  ) then
    raise exception 'Not authorized to review this attempt.';
  end if;

  return query
  select
    qq.id, qq.question_text, qq.question_type, qq.points, qq.sequence_order,
    qo.id, qo.option_text, qo.is_correct, qo.match_prompt, qo.sequence_order,
    qa.selected_option_id, qa.answer_text, qa.matched_pairs, qa.points_awarded
  from quiz_questions qq
  left join quiz_options qo on qo.question_id = qq.id
  left join quiz_answers qa on qa.attempt_id = p_attempt_id and qa.question_id = qq.id
  where qq.quiz_id = v_attempt.quiz_id
  order by qq.sequence_order, qo.sequence_order;
end;
$$;

revoke all on function get_quiz_attempt_review(uuid) from public;
grant execute on function get_quiz_attempt_review(uuid) to authenticated;
