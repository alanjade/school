-- get_quiz_attempt_questions leaked the answer key while an attempt was in
-- progress. It returned every quiz_options row for every question, and per
-- the data model in 20260803170100_quiz_question_types.sql:
--
--   fill_blank: the option rows ARE the accepted answers
--               (option_text = answer, is_correct = true).
--   matching:   each row is a canonical pair (match_prompt = left term,
--               option_text = its correct right-hand match).
--
-- The runner never rendered those fields, but the RPC response is readable
-- in the browser's network tab, so a student could lift the full key.
--
-- The fix is in the RPC's output, not the schema, so the RETURNS TABLE shape
-- is unchanged (CREATE OR REPLACE, grants preserved) and so is grading:
-- answer_quiz_question / submit_quiz_attempt still key matched_pairs on the
-- left row's quiz_options.id with the chosen right-hand text as the value.
--
-- What each question type now returns:
--
--   mcq / true_false  unchanged: one row per choice (option_id, option_text).
--                     is_correct was never returned.
--   fill_blank        one row, no option columns. The runner renders a plain
--                     text input and never needed the accepted answers.
--   essay             one row, no option columns (it has no options anyway).
--   matching          two kinds of rows:
--                       left rows:  option_id + match_prompt, option_text NULL
--                                   (ordered by the authored sequence).
--                       pool rows:  option_id NULL, match_prompt NULL,
--                                   option_sequence NULL, only option_text,
--                                   ordered by text.
--
-- Pool rows deliberately carry no id and no sequence, and are ordered by
-- text alone: authored order is the only thing that links the left and right
-- columns, so neither column may expose it. Left rows stay in authored
-- order (that was the existing UX and it reveals nothing without the pool's
-- order). A matching question with no options still yields one row so the
-- question itself is not dropped from the attempt.
--
-- The student's own saved answer columns (selected_option_id, answer_text,
-- matched_pairs) ride on the question's first-kind rows exactly as before and
-- are null on pool rows; the runner reads them from any row of the question.
--
-- Teacher preview is unaffected: it reads quiz_questions/quiz_options
-- directly through an admin/teacher-gated action, not this RPC.
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

  -- Columns are qualified as r.* below because the OUT parameters above
  -- share their names with the subquery's columns.
  return query
  select
    r.question_id, r.question_text, r.question_type, r.points, r.question_sequence,
    r.option_id, r.option_text, r.match_prompt, r.option_sequence,
    r.selected_option_id, r.answer_text, r.matched_pairs
  from (
    -- Question rows: choices for mcq/true_false, left terms for matching,
    -- and a single option-less row for fill_blank/essay (the join below
    -- matches nothing for those types, so the left join keeps one null row).
    select
      0 as part,
      qq.id as question_id, qq.question_text, qq.question_type, qq.points,
      qq.sequence_order as question_sequence,
      qo.id as option_id,
      case when qq.question_type = 'matching' then null else qo.option_text end as option_text,
      case when qq.question_type = 'matching' then qo.match_prompt else null end as match_prompt,
      qo.sequence_order as option_sequence,
      qa.selected_option_id, qa.answer_text, qa.matched_pairs
    from quiz_questions qq
    left join quiz_options qo
      on qo.question_id = qq.id
     and qq.question_type in ('mcq', 'true_false', 'matching')
    left join quiz_answers qa on qa.attempt_id = p_attempt_id and qa.question_id = qq.id
    where qq.quiz_id = v_attempt.quiz_id

    union all

    -- Matching pool: the right-hand terms only, detached from their prompts.
    select
      1,
      qq.id, qq.question_text, qq.question_type, qq.points,
      qq.sequence_order,
      null::uuid, qo.option_text, null::text, null::integer,
      null::uuid, null::text, null::jsonb
    from quiz_questions qq
    join quiz_options qo on qo.question_id = qq.id
    where qq.quiz_id = v_attempt.quiz_id
      and qq.question_type = 'matching'
  ) r
  order by
    case when v_shuffle then md5(p_attempt_id::text || r.question_id::text) end,
    case when not v_shuffle then r.question_sequence end,
    r.question_id,
    r.part,
    r.option_sequence,
    r.option_text;
end;
$$;
