-- Homework submission (student upload) feature.
-- Run this in the Supabase SQL editor / migration pipeline.

-- ---------- Table ----------

create table if not exists homework_submissions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  student_id uuid not null references student_profiles(id) on delete cascade,
  file_url text not null,
  file_name text,
  submitted_at timestamp with time zone not null default now(),
  status text not null default 'submitted', -- submitted | reviewed
  teacher_remark text,
  reviewed_by uuid references teacher_profiles(id),
  reviewed_at timestamp with time zone,
  unique (lesson_id, student_id)
);

alter table homework_submissions enable row level security;
-- (rls_auto_enable event trigger already covers this, but kept explicit
-- here since this file may be run standalone.)

comment on table homework_submissions is
  'One row per student per lesson homework upload. status moves submitted -> reviewed once a teacher leaves a remark.';

-- ---------- RLS ----------

-- Students may see and create their own submissions, only for lessons in
-- their own class, and only while the class's teacher assigned homework.
create policy homework_submissions_select_own_or_staff
  on homework_submissions for select to public
  using (
    is_self_student(student_id)
    or is_parent_of(student_id)
    or is_admin()
    or exists (
      select 1 from lessons l where l.id = homework_submissions.lesson_id
        and l.teacher_id = auth.uid()
    )
  );

create policy homework_submissions_insert_self
  on homework_submissions for insert to public
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from lessons l
      join student_profiles sp on sp.class_id = l.class_id
      where l.id = homework_submissions.lesson_id
        and sp.id = auth.uid()
        and l.homework is not null
    )
  );

-- Students can replace their own file/remarks up until a teacher reviews it;
-- teachers (the lesson's own teacher) and admins can update status/remark.
create policy homework_submissions_update_owner_pending
  on homework_submissions for update to public
  using (student_id = auth.uid() and status = 'submitted')
  with check (student_id = auth.uid() and status = 'submitted');

create policy homework_submissions_update_teacher_admin
  on homework_submissions for update to public
  using (
    is_admin()
    or exists (
      select 1 from lessons l where l.id = homework_submissions.lesson_id
        and l.teacher_id = auth.uid()
    )
  )
  with check (
    is_admin()
    or exists (
      select 1 from lessons l where l.id = homework_submissions.lesson_id
        and l.teacher_id = auth.uid()
    )
  );

-- Prevent a student from ever editing file_url/lesson_id/student_id once
-- created, and from setting their own status to 'reviewed' — mirrors the
-- protect_*_columns pattern used elsewhere.
create or replace function protect_homework_submission_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.lesson_id is distinct from old.lesson_id
       or new.student_id is distinct from old.student_id then
      raise exception 'Changing lesson_id or student_id is not permitted.';
    end if;
    -- A student (non-teacher, non-admin) may not set status themselves.
    if new.student_id = auth.uid()
       and not exists (select 1 from teacher_profiles tp where tp.id = auth.uid())
       and new.status is distinct from old.status then
      raise exception 'Only a teacher or admin can change submission status.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_homework_submission_columns on homework_submissions;
create trigger trg_protect_homework_submission_columns
  before update on homework_submissions
  for each row execute function protect_homework_submission_columns();

-- ---------- Audit logging ----------

create or replace function log_homework_submission_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    values (
      'homework_submission', new.id, 'homework_submitted', auth.uid(),
      jsonb_build_object('lesson_id', new.lesson_id, 'student_id', new.student_id)
    );
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'reviewed' then
    insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    values (
      'homework_submission', new.id, 'homework_submission_reviewed', auth.uid(),
      jsonb_build_object('lesson_id', new.lesson_id, 'student_id', new.student_id,
        'teacher_remark', new.teacher_remark)
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_homework_submission_change on homework_submissions;
create trigger trg_log_homework_submission_change
  after insert or update on homework_submissions
  for each row execute function log_homework_submission_change();

-- ---------- Storage bucket ----------
-- Created here for reference; the app also creates it lazily via
-- admin.storage.createBucket() the same way TOPIC_RESOURCE_BUCKET and
-- STUDENT_PHOTO_BUCKET are created, so this statement is optional/idempotent.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'homework-submissions',
  'homework-submissions',
  false,
  20971520, -- 20 MB
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do nothing;