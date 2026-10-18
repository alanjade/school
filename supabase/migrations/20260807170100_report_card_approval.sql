-- Adds approval workflow to report_card_remarks:
--   moderation_status: 'pending' (default) | 'approved'
--   approved_by:       which admin approved it
--   approved_at:       when it was approved
--
-- Students and parents may only see a report card once an admin has
-- explicitly approved it (status = 'approved'). Any subsequent edit
-- (by teacher or admin) via saveReportCardRemark() resets to 'pending'
-- so an edited card isn't silently visible without re-approval.

alter table report_card_remarks
  add column if not exists moderation_status text not null default 'pending',
  add column if not exists approved_by uuid references profiles(id),
  add column if not exists approved_at timestamp with time zone;

alter table report_card_remarks
  drop constraint if exists report_card_remarks_moderation_status_check;

alter table report_card_remarks
  add constraint report_card_remarks_moderation_status_check
    check (moderation_status in ('pending', 'approved'));

-- Unique constraint so upsert(onConflict: "student_id,term,academic_year") works
alter table report_card_remarks
  drop constraint if exists report_card_remarks_student_term_year_unique;

alter table report_card_remarks
  add constraint report_card_remarks_student_term_year_unique
    unique (student_id, term, academic_year);

-- RLS: students and parents only see approved remarks
drop policy if exists remarks_select on report_card_remarks;
drop policy if exists remarks_select_parent on report_card_remarks;
drop policy if exists remarks_write_staff on report_card_remarks;

-- Admins and teachers: see all rows regardless of approval status
create policy remarks_select_staff on report_card_remarks
  for select to public
  using (
    is_admin()
    or exists (
      select 1 from teacher_profiles where teacher_profiles.id = auth.uid()
    )
  );

-- Students: only see their own approved remarks
create policy remarks_select_student on report_card_remarks
  for select to public
  using (student_id = auth.uid() and moderation_status = 'approved');

-- Parents: only see approved remarks for their linked children
create policy remarks_select_parent on report_card_remarks
  for select to public
  using (is_parent_of(student_id) and moderation_status = 'approved');

-- Staff write: teachers can write class_teacher_remark; admins can write both
create policy remarks_write_staff on report_card_remarks
  for all to public
  using (
    is_admin()
    or exists (
      select 1 from student_profiles sp
      join timetable_entries te on te.class_id = sp.class_id
      where sp.id = report_card_remarks.student_id
        and te.teacher_id = auth.uid()
    )
  )
  with check (
    is_admin()
    or exists (
      select 1 from student_profiles sp
      join timetable_entries te on te.class_id = sp.class_id
      where sp.id = report_card_remarks.student_id
        and te.teacher_id = auth.uid()
    )
  );
