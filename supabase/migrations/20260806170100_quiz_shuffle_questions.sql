-- Randomized question order per student attempt (markdown-editor-todo
-- "nice to have"). Opt-in per quiz via a new quizzes.shuffle_questions
-- flag, off by default so every existing quiz keeps its authored order.
--
-- The shuffle itself is deterministic per (attempt_id, question_id)
-- rather than a one-off random() call at read time: get_quiz_attempt_
-- questions is called repeatedly for the same attempt (initial load,
-- any page refresh mid-attempt), and a *different* order on every call
-- would be actively confusing -- "did I already answer question 4, or
-- is this a different question 4?" md5(attempt_id || question_id) is
-- stable for the lifetime of the attempt (same two inputs -> same
-- hash), but differs attempt-to-attempt since attempt_id differs, so
-- two students (or the same student across two separate quizzes) get
-- independent shuffles without needing to persist an explicit order
-- column.

alter table quizzes add column if not exists shuffle_questions boolean not null default false;

-- create_quiz_with_questions: add p_shuffle_questions as a new trailing
-- parameter with a default, so existing callers (and the RPC's existing
-- signature) keep working via CREATE OR REPLACE -- no drop needed here
-- since only a param was appended, not the RETURNS shape.
create or replace function create_quiz_with_questions(
  p_subject_id uuid,
  p_class_id uuid,
  p_title text,
  p_term int,
  p_academic_year text,
  p_created_by uuid,
  p_duration_minutes int,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_questions jsonb,
  p_shuffle_questions boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_assessment_id uuid;
  v_quiz_id uuid;
  v_question_id uuid;
  v_total_points int;
  v_question jsonb;
  v_option jsonb;
  v_q_index int := 0;
  v_o_index int;
begin
  select coalesce(sum((q->>'points')::int), 0) into v_total_points
  from jsonb_array_elements(p_questions) as q;

  insert into assessments (
    subject_id, class_id, title, max_score, term, academic_year, created_by, assessment_type
  ) values (
    p_subject_id, p_class_id, p_title, v_total_points, p_term, p_academic_year, p_created_by, 'quiz'
  )
  returning id into v_assessment_id;

  insert into quizzes (assessment_id, duration_minutes, opens_at, closes_at, shuffle_questions)
  values (v_assessment_id, p_duration_minutes, p_opens_at, p_closes_at, coalesce(p_shuffle_questions, false))
  returning id into v_quiz_id;

  for v_question in select * from jsonb_array_elements(p_questions)
  loop
    v_q_index := v_q_index + 1;

    insert into quiz_questions (quiz_id, question_text, question_type, points, sequence_order)
    values (
      v_quiz_id,
      v_question->>'question_text',
      v_question->>'question_type',
      (v_question->>'points')::int,
      v_q_index
    )
    returning id into v_question_id;

    v_o_index := 0;
    for v_option in select * from jsonb_array_elements(coalesce(v_question->'options', '[]'::jsonb))
    loop
      v_o_index := v_o_index + 1;
      insert into quiz_options (question_id, option_text, match_prompt, is_correct, sequence_order)
      values (
        v_question_id,
        v_option->>'text',
        v_option->>'match_prompt',
        (v_option->>'is_correct')::boolean,
        v_o_index
      );
    end loop;
  end loop;

  return v_quiz_id;
end;
$$;

-- get_quiz_attempt_questions: order by the deterministic per-attempt
-- shuffle hash when the quiz has shuffle_questions on, else fall back to
-- the authored sequence_order exactly as before. Option order within a
-- question (mcq/true_false choices, matching's left-side rows) is left
-- alone either way -- randomizing *those* per attempt is a separate,
-- not-yet-requested feature, and shuffling them incidentally here would
-- change matching's left-to-right pairing UX without anyone asking for
-- that.
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
  v_shuffle boolean;
begin
  select * into v_attempt from quiz_attempts where id = p_attempt_id;
  if v_attempt.id is null or v_attempt.student_id <> auth.uid() then
    raise exception 'Attempt not found.';
  end if;

  select shuffle_questions into v_shuffle from quizzes where id = v_attempt.quiz_id;

  return query
  select
    qq.id, qq.question_text, qq.question_type, qq.points, qq.sequence_order,
    qo.id, qo.option_text, qo.match_prompt, qo.sequence_order,
    qa.selected_option_id, qa.answer_text, qa.matched_pairs
  from quiz_questions qq
  left join quiz_options qo on qo.question_id = qq.id
  left join quiz_answers qa on qa.attempt_id = p_attempt_id and qa.question_id = qq.id
  where qq.quiz_id = v_attempt.quiz_id
  order by
    case when v_shuffle then md5(p_attempt_id::text || qq.id::text) end,
    case when not v_shuffle then qq.sequence_order end,
    qo.sequence_order;
end;
$$;
