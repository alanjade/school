-- get_quiz_attempt_questions must not hand a student the answer key while an
-- attempt is in progress. Runs against the REAL schema (all repo migrations
-- replayed; see tests/sql/run.sh) and calls the RPC as a student.
--
--   fill_blank: the quiz_options rows are the accepted answers -> none may be
--               returned.
--   matching:   option_text is the correct right-hand match for match_prompt
--               -> no row may carry both, and the answer pool must not reveal
--               which term pairs with which (no ids, no authored order).

create function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ASSERT FAILED: %', msg; end if; end $$;
grant execute on function pg_temp.assert(boolean, text) to public;

-- Supabase grants these by default privileges; the scratch database has none.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------------------------------------------------------------- fixtures
-- Distinctive tokens so a leak anywhere in a row (any column) is detectable.
\set student   '00000000-0000-0000-0000-0000000000e1'
\set quiz      '00000000-0000-0000-0000-0000000000f1'
\set attempt   '00000000-0000-0000-0000-0000000000f2'
\set q_mcq     '00000000-0000-0000-0000-0000000000a1'
\set q_blank   '00000000-0000-0000-0000-0000000000a2'
\set q_essay   '00000000-0000-0000-0000-0000000000a3'
\set q_match   '00000000-0000-0000-0000-0000000000a4'
\set q_empty   '00000000-0000-0000-0000-0000000000a5'
\set o_mcq_a   '00000000-0000-0000-0000-0000000000b1'
\set o_mcq_b   '00000000-0000-0000-0000-0000000000b2'

-- Same scratch DB as license-features.test.sql: make sure the licence lets the
-- grading round-trip at the end run (answer/submit are licence-guarded).
select set_license('11111111-1111-1111-1111-111111111111', 1, '2026/2027',
  now() + interval '30 days', now() + interval '51 days', 300, array[]::text[]);

insert into auth.users (id, email) values (:'student', 'leak-student@test.local');
insert into profiles (id, role, full_name) values (:'student', 'student', 'Leak Student')
  on conflict (id) do update set role = 'student', is_active = true;
insert into student_profiles (id) values (:'student') on conflict do nothing;

with a as (
  insert into assessments (title, max_score, term, academic_year, assessment_type)
  values ('Leak quiz', 11, 1, '2026/2027', 'quiz') returning id
)
insert into quizzes (id, assessment_id, duration_minutes, is_published)
select :'quiz', a.id, 30, true from a;

insert into quiz_questions (id, quiz_id, question_text, question_type, points, sequence_order) values
  (:'q_mcq',   :'quiz', 'MCQ stem',          'mcq',        1, 1),
  (:'q_blank', :'quiz', 'Blank stem',        'fill_blank', 2, 2),
  (:'q_essay', :'quiz', 'Essay stem',        'essay',      3, 3),
  (:'q_match', :'quiz', 'Matching stem',     'matching',   4, 4),
  (:'q_empty', :'quiz', 'Empty match stem',  'matching',   1, 5);

insert into quiz_options (id, question_id, option_text, is_correct, sequence_order) values
  (:'o_mcq_a', :'q_mcq', 'Choice A', true,  1),
  (:'o_mcq_b', :'q_mcq', 'Choice B', false, 2);

-- Accepted answers for the fill-in-the-blank question.
insert into quiz_options (question_id, option_text, is_correct, sequence_order) values
  (:'q_blank', 'ZZANSWERONE', true, 1),
  (:'q_blank', 'ZZANSWERTWO', true, 2);

-- Canonical pairs. Authored right-hand order (Paris, Tokyo, Nairobi) is NOT
-- alphabetical, so a pool that kept authored order would be caught below.
insert into quiz_options (question_id, match_prompt, option_text, is_correct, sequence_order) values
  (:'q_match', 'France', 'Paris',   true, 1),
  (:'q_match', 'Japan',  'Tokyo',   true, 2),
  (:'q_match', 'Kenya',  'Nairobi', true, 3);

-- The student's own saved answers must still come back (resume mid-attempt).
-- Matching is saved against the LEFT row ids, as the runner does.
insert into quiz_attempts (id, quiz_id, student_id) values (:'attempt', :'quiz', :'student');
insert into quiz_answers (attempt_id, question_id, selected_option_id) values (:'attempt', :'q_mcq', :'o_mcq_b');
insert into quiz_answers (attempt_id, question_id, answer_text) values (:'attempt', :'q_blank', 'my guess');
insert into quiz_answers (attempt_id, question_id, matched_pairs)
select :'attempt', :'q_match', jsonb_build_object(min(id::text), 'Tokyo') from quiz_options where question_id = :'q_match' and match_prompt = 'France';

-- Correct pairs keyed by left option id, kept aside (as the superuser) for the
-- grading round-trip at the end.
select jsonb_object_agg(id::text, option_text)::text as correct_pairs
from quiz_options where question_id = :'q_match' \gset

-- ------------------------------------------------------ call RPC as student
set role authenticated;
set test.uid = :'student';

create temp table rows as select * from get_quiz_attempt_questions(:'attempt');

-- The premise of the fix: a student has no direct read path to the key either.
select pg_temp.assert((select count(*) from quiz_options) = 0, 'student cannot read quiz_options directly');

-- 1. No accepted answer appears in ANY column of ANY row.
select pg_temp.assert(not exists (select 1 from rows r where to_jsonb(r)::text like '%ZZANSWER%'),
  'fill_blank accepted answers are not in the response');

-- 2. fill_blank / essay: exactly one row, no option columns at all.
select pg_temp.assert((select count(*) from rows where question_type = 'fill_blank') = 1, 'fill_blank returns one row');
select pg_temp.assert((select count(*) from rows where question_type = 'essay') = 1, 'essay returns one row');
select pg_temp.assert(not exists (
  select 1 from rows where question_type in ('fill_blank', 'essay')
    and (option_id is not null or option_text is not null or match_prompt is not null or option_sequence is not null)),
  'fill_blank/essay rows carry no option columns');

-- 3. THE matching invariant: no row carries a prompt together with its match.
select pg_temp.assert(not exists (select 1 from rows where match_prompt is not null and option_text is not null),
  'no row has both a match_prompt and an option_text');

-- 4. Matching left rows: id + prompt, no answer text, authored order.
select pg_temp.assert((select count(*) from rows where question_id = :'q_match' and option_id is not null) = 3,
  'matching has three left rows');
select pg_temp.assert(not exists (
  select 1 from rows where question_id = :'q_match' and option_id is not null
    and (match_prompt is null or option_text is not null)),
  'left rows carry the prompt and never the answer text');
select pg_temp.assert(
  (select array_agg(match_prompt order by ord) from (select match_prompt, row_number() over () as ord
     from rows where question_id = :'q_match' and option_id is not null) l) = array['France', 'Japan', 'Kenya'],
  'left rows stay in authored order');

-- 5. Matching pool: right-hand terms only, no id / prompt / sequence, sorted by text.
select pg_temp.assert((select count(*) from rows where question_id = :'q_match' and option_id is null) = 3,
  'matching has three pool rows');
select pg_temp.assert(not exists (
  select 1 from rows where question_id = :'q_match' and option_id is null
    and (option_text is null or match_prompt is not null or option_sequence is not null
         or selected_option_id is not null or answer_text is not null or matched_pairs is not null)),
  'pool rows carry only option_text');
select pg_temp.assert(
  (select array_agg(option_text order by ord) from (select option_text, row_number() over () as ord
     from rows where question_id = :'q_match' and option_id is null) p) = array['Nairobi', 'Paris', 'Tokyo'],
  'pool is sorted by text, not authored order (authored order would pair up with the left rows)');
select pg_temp.assert(
  (select array_agg(match_prompt order by ord) from (select match_prompt, row_number() over () as ord
     from rows where question_id = :'q_match') x where match_prompt is not null) = array['France', 'Japan', 'Kenya']
  and (select min(ord) from (select option_id, row_number() over () as ord from rows where question_id = :'q_match') y where option_id is null)
    > (select max(ord) from (select option_id, row_number() over () as ord from rows where question_id = :'q_match') y where option_id is not null),
  'left rows come before the pool within the question');

-- 6. A matching question with no options still appears (one empty row).
select pg_temp.assert((select count(*) from rows where question_id = :'q_empty') = 1, 'option-less matching question is not dropped');
select pg_temp.assert(not exists (select 1 from rows where question_id = :'q_empty' and (option_id is not null or option_text is not null)),
  'option-less matching question has no option columns');

-- 7. mcq is unchanged: both choices, ids and text, authored order.
select pg_temp.assert((select count(*) from rows where question_id = :'q_mcq' and option_id is not null and option_text is not null) = 2,
  'mcq still returns its choices');

-- 8. Resume still works: the student's own saved answers come back.
select pg_temp.assert((select selected_option_id from rows where question_id = :'q_mcq' limit 1) = :'o_mcq_b',
  'saved mcq selection is returned');
select pg_temp.assert((select answer_text from rows where question_id = :'q_blank' limit 1) = 'my guess',
  'saved fill_blank text is returned');
select pg_temp.assert(exists (select 1 from rows where question_id = :'q_match' and matched_pairs is not null),
  'saved matching answer is returned');

-- 9. Grading is untouched: a student who only ever saw left ids + the sorted
-- pool can still earn the points by submitting {leftOptionId: chosenText}.
select answer_quiz_question(:'attempt', :'q_match', null, null, :'correct_pairs'::jsonb);
select pg_temp.assert((select score from submit_quiz_attempt(:'attempt')) = 4,
  'matching pairs submitted from the pool are graded as before');

reset role;

\echo ALL QUIZ ATTEMPT LEAK SQL TESTS PASSED
