-- Replaces the 4 separate `count(*, {count: "exact", head: true})` round
-- trips in AdminOverview (app/dashboard/admin/page.tsx) with a single RPC
-- call. Each of those was already an exact, indexed count on a single
-- small table (student_profiles/teacher_profiles/classes/subjects, no
-- filters) -- individually cheap -- but they were fired sequentially as
-- separate HTTP requests to PostgREST, so the page's latency was
-- (network round-trip x 4) rather than x1. This function does the same 4
-- exact counts inside one Postgres statement, so the app only pays for
-- one round trip.
--
-- Deliberately kept as exact counts, not `count: "estimated"`/"planned"
-- (which reads pg_class.reltuples, refreshed by autovacuum/ANALYZE and
-- not by the row itself). These 4 numbers double as the AdminOverview
-- onboarding checklist's "is this step done yet" flags
-- (subjectCount > 0, classCount > 0, ...) -- exactly the moment a school
-- has 1-2 freshly inserted rows an estimate is least likely to reflect
-- yet, which would show a completed setup step as still pending right
-- after the admin did it. These tables are scoped to a single school, so
-- exact counts stay cheap regardless.
create or replace function admin_overview_counts()
returns table(
  student_count bigint,
  teacher_count bigint,
  class_count bigint,
  subject_count bigint
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if not is_admin() then
    raise exception 'Not authorized.';
  end if;

  return query
  select
    (select count(*) from student_profiles),
    (select count(*) from teacher_profiles),
    (select count(*) from classes),
    (select count(*) from subjects);
end;
$$;

revoke all on function admin_overview_counts() from public;
grant execute on function admin_overview_counts() to authenticated;
