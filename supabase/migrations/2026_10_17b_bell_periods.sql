-- School-wide bell schedule.
--
-- Until now the only place a period's clock time lived was on each
-- timetable_entries row (period_number + start_time + end_time), so there
-- was no single answer to "when is Period 2?" -- every lesson carried its
-- own copy, and nothing stopped two lessons in the same period from
-- disagreeing. This table is that single answer: the ordered list of
-- lesson periods and breaks that make up the school day.
--
-- It is deliberately additive. timetable_entries keeps its own
-- start_time/end_time columns (BellTimer, the teacher/parent timetable
-- pages and the teacher schedule view all read them), the timetable entry
-- form now fills them in from this table, and an explicit admin action
-- re-syncs existing lessons. Nothing here rewrites existing rows.
--
-- period_number is NULL for breaks and required (> 0) for lessons, and is
-- unique among lessons, so a lesson period is addressable by the same
-- number timetable_entries.period_number already uses. Overlap between
-- rows is validated in lib/actions/bellSchedule.ts rather than with an
-- exclusion constraint, because Postgres has no built-in time-of-day range
-- type to build one on.

create table if not exists bell_periods (
  id uuid not null default gen_random_uuid(),
  period_number integer,
  label text not null,
  is_break boolean not null default false,
  start_time time without time zone not null,
  end_time time without time zone not null,
  created_at timestamp with time zone not null default now(),
  constraint bell_periods_pkey primary key (id),
  constraint bell_periods_time_order check (end_time > start_time),
  constraint bell_periods_kind check (
    (is_break and period_number is null)
    -- `is not null` is required: `null > 0` is NULL, which a CHECK treats as passing.
    or (not is_break and period_number is not null and period_number > 0)
  )
);

create unique index if not exists uq_bell_periods_number
  on bell_periods (period_number)
  where period_number is not null;

create index if not exists idx_bell_periods_start on bell_periods (start_time);

alter table bell_periods enable row level security;

-- Every signed-in user needs to read it: the grid and the entry form are
-- used by admins, but teachers, students and parents see the same
-- timetable and shouldn't each need a bespoke policy for its row labels.
create policy bell_periods_select on bell_periods for select to public
  using ((select auth.uid()) is not null);

create policy bell_periods_write_admin on bell_periods for all to public
  using (is_admin()) with check (is_admin());
