-- Migration: hostel visitor log — an EXTERNAL person visiting a resident
-- student, distinct from hostel_leave_logs (which tracks a resident
-- leaving/returning). Mirrors hostel_leave_logs' shape and RLS exactly.

begin;

CREATE TABLE public.hostel_visitor_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.student_profiles(id),
  visitor_name text NOT NULL,
  visitor_phone text,
  relationship text,
  purpose text,
  checked_in_at timestamp with time zone NOT NULL DEFAULT now(),
  checked_out_at timestamp with time zone,
  logged_by uuid REFERENCES public.profiles(id),
  checked_out_logged_by uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.hostel_visitor_logs ENABLE ROW LEVEL SECURITY;

-- Same visibility shape as hostel_leave_logs: the student themself, their
-- parent, an admin, or that hostel's house parent.
CREATE POLICY hostel_visitor_logs_select ON public.hostel_visitor_logs FOR SELECT TO public
  USING (
    is_self_student(student_id)
    OR is_parent_of(student_id)
    OR is_admin()
    OR is_house_parent_of_student(student_id)
  );

CREATE POLICY hostel_visitor_logs_write ON public.hostel_visitor_logs FOR ALL TO public
  USING (is_admin() OR is_house_parent_of_student(student_id))
  WITH CHECK (is_admin() OR is_house_parent_of_student(student_id));

CREATE OR REPLACE FUNCTION public.log_hostel_visitor_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    values (
      'hostel_visitor_log', new.id, 'hostel_visitor_checked_in', auth.uid(),
      jsonb_build_object('student_id', new.student_id, 'visitor_name', new.visitor_name,
        'purpose', new.purpose)
    );
  elsif tg_op = 'UPDATE' and new.checked_out_at is distinct from old.checked_out_at
        and new.checked_out_at is not null then
    insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    values (
      'hostel_visitor_log', new.id, 'hostel_visitor_checked_out', auth.uid(),
      jsonb_build_object('student_id', new.student_id, 'visitor_name', new.visitor_name)
    );
  end if;
  return new;
end;
$function$;

CREATE TRIGGER trg_log_hostel_visitor_change
  AFTER INSERT OR UPDATE ON public.hostel_visitor_logs
  FOR EACH ROW EXECUTE FUNCTION public.log_hostel_visitor_change();

commit;