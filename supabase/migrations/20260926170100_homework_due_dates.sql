-- Homework due-date support. `lessons.homework` / `homework_status` already
-- existed with nothing tracking *when* it's due, so "due soon"/"overdue"
-- had no data to surface from. date (not timestamptz) to match the existing
-- `lesson_date` and `library_loans.due_at` convention -- homework due dates
-- are day-granularity, not time-of-day.

alter table lessons
  add column if not exists homework_due_at date;

comment on column lessons.homework_due_at is
  'Due date for lessons.homework, set by the teacher when assigning it. Null when no homework was given or no due date was set.';
