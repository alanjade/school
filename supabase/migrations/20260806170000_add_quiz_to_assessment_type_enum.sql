-- 20260728164237_initial_schema.sql's assessment_type enum was flagged in
-- its own comment as "ASSUMED ENUM VALUES (inferred -- verify before
-- relying on this in prod)" -- it listed 'quiz' as if it already existed,
-- but that list was a reconstruction, not a dump of the real database.
-- create_quiz_with_questions() (2026_08_05b) hardcodes assessment_type =
-- 'quiz' on every insert, and Postgres rejects it with "invalid input
-- value for enum assessment_type: quiz" -- proof the live enum never
-- actually had this value. Additive only, like the sibling fix migration,
-- since existing assessment rows may already rely on the current set.
alter type assessment_type add value if not exists 'quiz';
