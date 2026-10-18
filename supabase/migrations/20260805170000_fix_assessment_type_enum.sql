-- The initial_schema migration's `assessment_type` enum was reconstructed
-- from a schema dump with "ASSUMED ENUM VALUES" (exam, test, quiz,
-- assignment, project, other) that never matched what the app actually
-- inserts:
--   - teacher.ts's STANDARD_ASSESSMENTS / CreateAssessmentForm.tsx insert
--     'first_ca', 'second_ca', and 'practical', none of which existed in
--     that enum.
--   - 'quiz' existed in the enum but was never used -- createQuiz()
--     (lib/actions/quiz.ts) left assessment_type at its 'other' default.
-- Add the missing values so both sides agree. Values are additive only;
-- nothing is removed since existing rows may already use 'other'/'exam'/etc.
alter type assessment_type add value if not exists 'first_ca';
alter type assessment_type add value if not exists 'second_ca';
alter type assessment_type add value if not exists 'practical';
