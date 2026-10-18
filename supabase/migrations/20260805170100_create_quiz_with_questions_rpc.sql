-- createQuiz() (lib/actions/quiz.ts) built a quiz across four sequential
-- inserts: assessments -> quizzes -> quiz_questions (one per question) ->
-- quiz_options (one batch per question). Only the assessment/quiz pair had
-- a best-effort rollback; if question 3 of 5 failed, questions 1-2 (and
-- their options) plus the quiz and assessment rows were left orphaned with
-- nothing pointing at them and nothing to clean them up.
--
-- Wrapping the whole thing in one plpgsql function makes it atomic: a
-- Postgres function body runs inside a single transaction, so any
-- exception (a NOT NULL violation, a bad enum value, whatever) rolls back
-- every insert made so far in this call, not just the last one.
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
  -- [{ "question_text": text, "question_type": text, "points": int,
  --    "options": [{ "text": text, "is_correct": bool, "match_prompt": text|null }] }, ...]
  -- Matches QuestionInput in lib/actions/quiz.ts one-to-one; that file
  -- still owns all validation (min options, correct-answer-present,
  -- etc.) -- this function assumes it's already been checked and only
  -- does the writes.
  p_questions jsonb
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

  insert into quizzes (assessment_id, duration_minutes, opens_at, closes_at)
  values (v_assessment_id, p_duration_minutes, p_opens_at, p_closes_at)
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
