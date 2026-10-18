-- Adds fill-in-the-blank, matching, and essay question types to quizzes.
-- Existing mcq/true_false behavior and data are untouched.
--
-- Data model:
--   fill_blank: quiz_options rows are accepted answers (option_text = one
--     accepted answer, is_correct = true for all of them; no wrong options
--     needed). Student's answer is free text in quiz_answers.answer_text,
--     graded case-insensitively/trimmed against any accepted answer.
--   matching: quiz_options rows are the canonical pairs (match_prompt =
--     left side, option_text = the correct right-side match for it).
--     Student assembles matched_pairs jsonb ({optionId: chosenRightText})
--     in quiz_answers, graded all-or-nothing per question (every pair
--     must match for the points).
--   essay: no quiz_options at all. Student's answer is free text in
--     quiz_answers.answer_text. Never auto-scored — contributes 0 at
--     submit time; a teacher grades it afterward via
--     grade_quiz_essay_answers(), which recomputes and updates the
--     attempt's score/linked grade.

alter table quiz_options add column match_prompt text;

alter table quiz_answers add column answer_text text;
alter table quiz_answers add column matched_pairs jsonb;
alter table quiz_answers add column points_awarded numeric;

comment on column quiz_answers.points_awarded is
  'Manual override for essay questions, set by grade_quiz_essay_answers(). Null until a teacher grades it.';

-- answer_quiz_question: extended to accept a free-text answer or a
-- matching submission alongside (or instead of) a selected option, so
-- the same RPC still covers every question type. New parameters were
-- added, so CREATE OR REPLACE can't be used as-is -- drop first.
drop function if exists answer_quiz_question(uuid, uuid, uuid);

create or replace function answer_quiz_question(
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid default null,
  p_answer_text text default null,
  p_matched_pairs jsonb default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_attempt quiz_attempts;
  v_quiz quizzes;
begin
  select * into v_attempt from quiz_attempts where id = p_attempt_id;
  if v_attempt.id is null or v_attempt.student_id <> auth.uid() then
    raise exception 'Attempt not found.';
  end if;
  if v_attempt.submitted_at is not null then
    raise exception 'This quiz has already been submitted.';
  end if;

  select * into v_quiz from quizzes where id = v_attempt.quiz_id;
  if now() > v_attempt.started_at + (v_quiz.duration_minutes || ' minutes')::interval then
    raise exception 'Time is up for this quiz attempt.';
  end if;

  if not exists (
    select 1 from quiz_questions where id = p_question_id and quiz_id = v_attempt.quiz_id
  ) then
    raise exception 'That question does not belong to this quiz.';
  end if;
  if p_selected_option_id is not null and not exists (
    select 1 from quiz_options where id = p_selected_option_id and question_id = p_question_id
  ) then
    raise exception 'That option does not belong to this question.';
  end if;

  insert into quiz_answers (attempt_id, question_id, selected_option_id, answer_text, matched_pairs)
  values (p_attempt_id, p_question_id, p_selected_option_id, p_answer_text, p_matched_pairs)
  on conflict (attempt_id, question_id)
  do update set
    selected_option_id = excluded.selected_option_id,
    answer_text = excluded.answer_text,
    matched_pairs = excluded.matched_pairs,
    answered_at = now();
end;
$$;

-- get_quiz_attempt_questions: also return match_prompt (so the matching
-- UI has the left-side prompts) plus the student's saved free-text/
-- matching answer for resuming an in-progress attempt. The RETURNS TABLE
-- shape changed (three new columns), and Postgres treats that as a
-- different function signature under the hood (its row type is defined
-- by OUT parameters) -- CREATE OR REPLACE can't change that, only add/
-- rename trailing params with the same output shape. Drop first, same
-- reasoning as answer_quiz_question above.
drop function if exists get_quiz_attempt_questions(uuid);

create or replace function get_quiz_attempt_questions(p_attempt_id uuid)
returns table(
  question_id uuid,
  question_text text,
  question_type text,
  points numeric,
  question_sequence integer,
  option_id uuid,
  option_text text,
  match_prompt text,
  option_sequence integer,
  selected_option_id uuid,
  answer_text text,
  matched_pairs jsonb
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_attempt quiz_attempts;
begin
  select * into v_attempt from quiz_attempts where id = p_attempt_id;
  if v_attempt.id is null or v_attempt.student_id <> auth.uid() then
    raise exception 'Attempt not found.';
  end if;

  return query
  select
    qq.id, qq.question_text, qq.question_type, qq.points, qq.sequence_order,
    qo.id, qo.option_text, qo.match_prompt, qo.sequence_order,
    qa.selected_option_id, qa.answer_text, qa.matched_pairs
  from quiz_questions qq
  left join quiz_options qo on qo.question_id = qq.id
  left join quiz_answers qa on qa.attempt_id = p_attempt_id and qa.question_id = qq.id
  where qq.quiz_id = v_attempt.quiz_id
  order by qq.sequence_order, qo.sequence_order;
end;
$$;

-- submit_quiz_attempt: extended scoring —
--   mcq/true_false unchanged (join on selected_option_id + is_correct)
--   fill_blank: points if answer_text matches any accepted answer
--     (case-insensitive, trimmed)
--   matching: all-or-nothing — every pair for the question must match
--   essay: contributes 0 here; graded later via grade_quiz_essay_answers
create or replace function submit_quiz_attempt(p_attempt_id uuid)
returns table(score numeric, total_points numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_attempt quiz_attempts;
  v_quiz quizzes;
  v_score numeric;
  v_total numeric;
  v_grade_id uuid;
begin
  select * into v_attempt from quiz_attempts where id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.student_id <> auth.uid() then
    raise exception 'Attempt not found.';
  end if;
  if v_attempt.submitted_at is not null then
    score := v_attempt.score;
    total_points := v_attempt.total_points;
    return next;
    return;
  end if;

  select * into v_quiz from quizzes where id = v_attempt.quiz_id;

  select coalesce(sum(qq.points), 0) into v_total
  from quiz_questions qq where qq.quiz_id = v_attempt.quiz_id;

  select coalesce(sum(pts), 0) into v_score
  from (
    -- mcq / true_false
    select qq.points as pts
    from quiz_answers qa
    join quiz_questions qq on qq.id = qa.question_id
    join quiz_options qo on qo.id = qa.selected_option_id
    where qa.attempt_id = p_attempt_id
      and qq.question_type in ('mcq', 'true_false')
      and qo.is_correct

    union all

    -- fill in the blank: any accepted answer matches, case-insensitive/trimmed
    select qq.points as pts
    from quiz_answers qa
    join quiz_questions qq on qq.id = qa.question_id
    where qa.attempt_id = p_attempt_id
      and qq.question_type = 'fill_blank'
      and qa.answer_text is not null
      and exists (
        select 1 from quiz_options qo
        where qo.question_id = qq.id
          and qo.is_correct
          and lower(trim(qo.option_text)) = lower(trim(qa.answer_text))
      )

    union all

    -- matching: all-or-nothing, every canonical pair must be matched correctly
    select qq.points as pts
    from quiz_answers qa
    join quiz_questions qq on qq.id = qa.question_id
    where qa.attempt_id = p_attempt_id
      and qq.question_type = 'matching'
      and qa.matched_pairs is not null
      and not exists (
        select 1 from quiz_options qo
        where qo.question_id = qq.id
          and lower(trim(coalesce(qa.matched_pairs ->> qo.id::text, ''))) <> lower(trim(qo.option_text))
      )
      and exists (select 1 from quiz_options qo where qo.question_id = qq.id)
  ) scored;

  insert into grades (assessment_id, student_id, score, moderation_status)
  values (v_quiz.assessment_id, v_attempt.student_id, v_score, 'pending')
  returning id into v_grade_id;

  update quiz_attempts
    set submitted_at = now(), score = v_score, total_points = v_total, grade_id = v_grade_id
    where id = p_attempt_id;

  insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
  values (
    'quiz_attempt', p_attempt_id, 'quiz_attempt_submitted', auth.uid(),
    jsonb_build_object('quiz_id', v_attempt.quiz_id, 'score', v_score, 'total_points', v_total)
  );

  score := v_score;
  total_points := v_total;
  return next;
end;
$$;

-- Grades one or more essay answers on an already-submitted attempt and
-- recomputes the attempt's score (auto-graded portion + essay points
-- just awarded), keeping quiz_attempts and the linked grades row in
-- sync. Only the quiz's own teacher (via subjects_taught) or an admin
-- may grade; mirrors the check createQuiz already does in application
-- code, enforced here too since this RPC is reachable directly.
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
    if not exists (
      select 1 from quiz_questions
      where id = v_entry.question_id::uuid and quiz_id = v_attempt.quiz_id and question_type = 'essay'
    ) then
      raise exception 'Question % is not an essay question on this quiz.', v_entry.question_id;
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
