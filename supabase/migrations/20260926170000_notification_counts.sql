-- Unified unread-notification support for the nav badge: messages,
-- announcements, and graded homework.
--
-- messages already has a per-recipient `read` boolean, so that part needs
-- no schema change. announcements are broadcast to many recipients at
-- once (audience/class-targeted), so "read" has to be tracked per
-- (announcement, user) pair -- hence the new announcement_reads table.
-- Homework grading only ever has one interested viewer (the student who
-- submitted it), so that's a single nullable timestamp column on the
-- existing row rather than a join table.

-- ---------- announcement_reads ----------

create table if not exists announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  read_at timestamp with time zone not null default now(),
  unique (announcement_id, user_id)
);

alter table announcement_reads enable row level security;

create policy announcement_reads_select_own
  on announcement_reads for select to public
  using (user_id = auth.uid());

create policy announcement_reads_insert_own
  on announcement_reads for insert to public
  with check (user_id = auth.uid());

comment on table announcement_reads is
  'One row per (announcement, user) once that user has viewed it. Populated by mark_all_announcements_read(), read by get_notification_counts().';

-- ---------- homework_submissions.grade_seen_at ----------

alter table homework_submissions
  add column if not exists grade_seen_at timestamp with time zone;

comment on column homework_submissions.grade_seen_at is
  'Set once the student has visited their homework page after status moved to reviewed. Null = unseen graded feedback.';

-- ---------- mark_all_announcements_read() ----------
--
-- Mirrors the audience/class visibility rules in
-- app/dashboard/announcements/page.tsx exactly, so "unread" here always
-- means "visible to this user, on the announcements page, and not yet
-- marked read" -- never more, never less.

create or replace function mark_all_announcements_read()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role user_role;
  v_class_id uuid;
  v_class_ids uuid[];
begin
  select role into v_role from profiles where id = auth.uid();

  if v_role = 'admin' then
    insert into announcement_reads (announcement_id, user_id)
    select a.id, auth.uid()
    from announcements a
    on conflict (announcement_id, user_id) do nothing;
    return;
  end if;

  if v_role = 'student' then
    select class_id into v_class_id from student_profiles where id = auth.uid();
    insert into announcement_reads (announcement_id, user_id)
    select a.id, auth.uid()
    from announcements a
    where a.audience in ('all', 'students')
       or (a.audience = 'class' and a.class_id = v_class_id)
    on conflict (announcement_id, user_id) do nothing;
    return;
  end if;

  if v_role = 'teacher' then
    select array_agg(distinct class_id) into v_class_ids
    from timetable_entries where teacher_id = auth.uid();

    insert into announcement_reads (announcement_id, user_id)
    select a.id, auth.uid()
    from announcements a
    where a.audience in ('all', 'teachers')
       or (a.audience = 'class' and a.class_id = any(coalesce(v_class_ids, array[]::uuid[])))
    on conflict (announcement_id, user_id) do nothing;
    return;
  end if;

  -- Parents and any other role: same fallback the announcements page
  -- uses (['all','students','teachers','class']), but class-targeted
  -- ones never resolve for them there (relevantClassIds stays empty), so
  -- only class-less audiences apply.
  insert into announcement_reads (announcement_id, user_id)
  select a.id, auth.uid()
  from announcements a
  where a.audience in ('all', 'students', 'teachers')
  on conflict (announcement_id, user_id) do nothing;
end;
$$;

revoke all on function mark_all_announcements_read() from public;
grant execute on function mark_all_announcements_read() to authenticated;

-- ---------- mark_all_homework_seen() ----------

create or replace function mark_all_homework_seen()
returns void
language sql
security definer
set search_path to 'public'
as $$
  update homework_submissions
  set grade_seen_at = now()
  where student_id = auth.uid()
    and status = 'reviewed'
    and grade_seen_at is null;
$$;

revoke all on function mark_all_homework_seen() from public;
grant execute on function mark_all_homework_seen() to authenticated;

-- ---------- get_notification_counts() ----------
--
-- One round trip for the sidebar badge instead of three. Unread
-- announcement/homework counts use the exact same visibility rules as
-- the mark_all_* functions above, so a count can never show >0 for
-- something the user has no route to actually go mark read.

create or replace function get_notification_counts()
returns table(
  unread_messages bigint,
  unread_announcements bigint,
  unread_graded_homework bigint
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_role user_role;
  v_class_id uuid;
  v_class_ids uuid[];
  v_messages bigint := 0;
  v_announcements bigint := 0;
  v_homework bigint := 0;
begin
  select role into v_role from profiles where id = auth.uid();

  select count(*) into v_messages
  from messages
  where recipient_id = auth.uid() and coalesce(read, false) = false;

  if v_role = 'admin' then
    select count(*) into v_announcements
    from announcements a
    where not exists (
      select 1 from announcement_reads r
      where r.announcement_id = a.id and r.user_id = auth.uid()
    );

  elsif v_role = 'student' then
    select class_id into v_class_id from student_profiles where id = auth.uid();

    select count(*) into v_announcements
    from announcements a
    where (a.audience in ('all', 'students')
        or (a.audience = 'class' and a.class_id = v_class_id))
      and not exists (
        select 1 from announcement_reads r
        where r.announcement_id = a.id and r.user_id = auth.uid()
      );

    select count(*) into v_homework
    from homework_submissions hs
    where hs.student_id = auth.uid()
      and hs.status = 'reviewed'
      and hs.grade_seen_at is null;

  elsif v_role = 'teacher' then
    select array_agg(distinct class_id) into v_class_ids
    from timetable_entries where teacher_id = auth.uid();

    select count(*) into v_announcements
    from announcements a
    where (a.audience in ('all', 'teachers')
        or (a.audience = 'class' and a.class_id = any(coalesce(v_class_ids, array[]::uuid[]))))
      and not exists (
        select 1 from announcement_reads r
        where r.announcement_id = a.id and r.user_id = auth.uid()
      );

  else
    select count(*) into v_announcements
    from announcements a
    where a.audience in ('all', 'students', 'teachers')
      and not exists (
        select 1 from announcement_reads r
        where r.announcement_id = a.id and r.user_id = auth.uid()
      );
  end if;

  return query select v_messages, v_announcements, v_homework;
end;
$$;

revoke all on function get_notification_counts() from public;
grant execute on function get_notification_counts() to authenticated;
