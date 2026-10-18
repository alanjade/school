-- Rework attendance from per-lesson (any subject teacher, per period) to a
-- single record per student per class per day, taken only by the class
-- teacher. No existing attendance data needs to be preserved.

drop policy if exists attendance_insert_assigned_teacher on attendance;
drop policy if exists attendance_select_own_or_staff on attendance;
drop policy if exists attendance_select_parent on attendance;
drop policy if exists attendance_update_assigned_teacher on attendance;

drop table if exists attendance;

create table attendance (
  id uuid not null default gen_random_uuid(),
  class_id uuid not null,
  student_id uuid not null,
  date date not null,
  status attendance_status not null,
  marked_by uuid,
  marked_at timestamp with time zone default now(),
  constraint attendance_pkey primary key (id),
  constraint attendance_class_id_fkey foreign key (class_id) references classes(id),
  constraint attendance_student_id_fkey foreign key (student_id) references student_profiles(id),
  constraint attendance_marked_by_fkey foreign key (marked_by) references teacher_profiles(id),
  constraint attendance_class_student_date_key unique (class_id, student_id, date)
);

alter table attendance enable row level security;

-- Only the class's own class teacher (or admin) may mark/update attendance
-- for that class.
create policy attendance_insert_class_teacher on attendance for insert to public
  with check (
    is_admin()
    or exists (
      select 1 from classes c
      where c.id = attendance.class_id and c.class_teacher_id = auth.uid()
    )
  );

create policy attendance_update_class_teacher on attendance for update to public
  using (
    is_admin()
    or exists (
      select 1 from classes c
      where c.id = attendance.class_id and c.class_teacher_id = auth.uid()
    )
  );

create policy attendance_select_own_or_staff on attendance for select to public
  using (is_self_student(student_id) or is_admin() or marked_by = auth.uid());

create policy attendance_select_parent on attendance for select to public
  using (is_parent_of(student_id));
