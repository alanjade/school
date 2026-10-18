-- grade_quiz_essay_answers() (2026_08_03b) wrote whatever numeric value
-- a teacher typed in straight into quiz_answers.points_awarded, with no
-- check against the question's own `points` (its max) or against zero.
-- A negative score, or a score higher than the question is worth, was
-- silently accepted and folded into the attempt's total via the
-- recompute below it -- there was nothing stopping an essay question
-- worth 10 points from contributing -5 or 999 to a student's grade.
create or replace function grade_quiz_essay_answers(p_attempt_id uuid, p_scores jsonb)
returns table(score numeric, total_points numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_attempt quiz_attempts;
  v_quiz quizzes;
  v_assessment assessments;
  v_score numeric;
  v_entry record;
  v_max_points numeric;
begin
  select * into v_attempt from quiz_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then
    raise exception 'Attempt not found.';
  end if;
  if v_attempt.submitted_at is null then
    raise exception 'This attempt has not been submitted yet.';
  end if;

  select * into v_quiz from quizzes where id = v_attempt.quiz_id;
  select * into v_assessment from assessments where id = v_quiz.assessment_id;

  if not (
    is_admin()
    or exists (
      select 1 from teacher_profiles tp
      where tp.id = auth.uid() and v_assessment.subject_id = any(tp.subjects_taught)
    )
  ) then
    raise exception 'Not authorized to grade this quiz.';
  end if;

  -- p_scores: { "<questionId>": <points awarded> }
  for v_entry in select key as question_id, value::numeric as pts from jsonb_each_text(p_scores)
  loop
    select points into v_max_points from quiz_questions
      where id = v_entry.question_id::uuid and quiz_id = v_attempt.quiz_id and question_type = 'essay';

    if v_max_points is null then
      raise exception 'Question % is not an essay question on this quiz.', v_entry.question_id;
    end if;

    if v_entry.pts < 0 or v_entry.pts > v_max_points then
      raise exception 'Score for question % must be between 0 and % (that question''s max).',
        v_entry.question_id, v_max_points;
    end if;

    update quiz_answers
      set points_awarded = v_entry.pts
      where attempt_id = p_attempt_id and question_id = v_entry.question_id::uuid;

    if not found then
      insert into quiz_answers (attempt_id, question_id, points_awarded)
      values (p_attempt_id, v_entry.question_id::uuid, v_entry.pts);
    end if;
  end loop;

  -- Recompute: everything submit_quiz_attempt already scored, plus
  -- whatever essay points have been awarded so far (partial grading —
  -- a teacher can grade essays one at a time across visits).
  select
    coalesce(sum(case when qq.question_type in ('mcq', 'true_false') and qo.is_correct then qq.points
                       when qq.question_type = 'fill_blank' and qa.answer_text is not null
                            and exists (
                              select 1 from quiz_options qo2
                              where qo2.question_id = qq.id and qo2.is_correct
                                and lower(trim(qo2.option_text)) = lower(trim(qa.answer_text))
                            ) then qq.points
                       when qq.question_type = 'matching' and qa.matched_pairs is not null
                            and exists (select 1 from quiz_options qo3 where qo3.question_id = qq.id)
                            and not exists (
                              select 1 from quiz_options qo3
                              where qo3.question_id = qq.id
                                and lower(trim(coalesce(qa.matched_pairs ->> qo3.id::text, ''))) <> lower(trim(qo3.option_text))
                            ) then qq.points
                       when qq.question_type = 'essay' then coalesce(qa.points_awarded, 0)
                       else 0
                  end), 0)
  into v_score
  from quiz_answers qa
  join quiz_questions qq on qq.id = qa.question_id
  left join quiz_options qo on qo.id = qa.selected_option_id
  where qa.attempt_id = p_attempt_id;

  update quiz_attempts set score = v_score where id = p_attempt_id;
  update grades set score = v_score where id = v_attempt.grade_id;

  insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
  values (
    'quiz_attempt', p_attempt_id, 'quiz_essay_graded', auth.uid(),
    jsonb_build_object('quiz_id', v_attempt.quiz_id, 'score', v_score)
  );

  score := v_score;
  total_points := v_attempt.total_points;
  return next;
end;
$$;
