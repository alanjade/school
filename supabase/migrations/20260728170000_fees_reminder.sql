-- Auto-reminders for fee defaulters (in-app messages, v1 — no email/SMS).
-- Run this in the Supabase SQL editor / migration pipeline.

-- ---------- Schema ----------

alter table invoices add column if not exists last_reminded_at timestamp with time zone;

comment on column invoices.last_reminded_at is
  'Last time a fee reminder message was sent for this invoice. Used to dedup send_fee_reminders() runs.';

-- ---------- RPC ----------

-- Sends one in-app message per still-owing invoice not reminded in the
-- last p_min_days_between days, to every linked parent (or the student
-- themself if no parent is linked). Admin/bursar only. Returns how many
-- messages were sent so the UI can show a result.
create or replace function send_fee_reminders(p_min_days_between integer default 7)
returns table(reminders_sent integer, invoices_considered integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_invoice record;
  v_recipient_id uuid;
  v_sent integer := 0;
  v_considered integer := 0;
  v_school_name text;
  v_had_recipient boolean;
begin
  if not (is_admin() or is_bursar()) then
    raise exception 'Only an admin or the bursar can send fee reminders.';
  end if;

  select name into v_school_name from school_settings where id = 1;

  for v_invoice in
    select
      i.id, i.student_id, i.total_amount_kobo, i.discount_kobo, i.amount_paid_kobo,
      i.term, i.academic_year,
      p.full_name as student_name,
      coalesce(fs.title, tfs.title, hfs.title, 'School fee') as fee_title
    from invoices i
    join student_profiles sp on sp.id = i.student_id
    join profiles p on p.id = sp.id
    left join fee_structures fs on fs.id = i.fee_structure_id
    left join transport_fee_structures tfs on tfs.id = i.transport_fee_structure_id
    left join hostel_fee_structures hfs on hfs.id = i.hostel_fee_structure_id
    where i.status in ('unpaid', 'partial')
      and i.voided_at is null
      and (i.last_reminded_at is null
           or i.last_reminded_at < now() - (p_min_days_between || ' days')::interval)
  loop
    v_considered := v_considered + 1;
    v_had_recipient := false;

    for v_recipient_id in
      select gl.parent_id from guardian_links gl where gl.student_id = v_invoice.student_id
    loop
      v_had_recipient := true;
      insert into messages (sender_id, recipient_id, content)
      values (
        auth.uid(),
        v_recipient_id,
        format(
          'Reminder: %s owes %s (Term %s, %s) for %s. Balance: ₦%s.',
          v_invoice.student_name,
          coalesce(v_school_name, 'the school'),
          v_invoice.term,
          v_invoice.academic_year,
          v_invoice.fee_title,
          to_char(
            (v_invoice.total_amount_kobo - v_invoice.discount_kobo - v_invoice.amount_paid_kobo) / 100.0,
            'FM999,999,999.00'
          )
        )
      );
    end loop;

    -- No parent linked: fall back to messaging the student directly so the
    -- reminder isn't silently dropped.
    if not v_had_recipient then
      insert into messages (sender_id, recipient_id, content)
      values (
        auth.uid(),
        v_invoice.student_id,
        format(
          'Reminder: you owe %s (Term %s, %s) for %s. Balance: ₦%s.',
          coalesce(v_school_name, 'the school'),
          v_invoice.term,
          v_invoice.academic_year,
          v_invoice.fee_title,
          to_char(
            (v_invoice.total_amount_kobo - v_invoice.discount_kobo - v_invoice.amount_paid_kobo) / 100.0,
            'FM999,999,999.00'
          )
        )
      );
    end if;

    update invoices set last_reminded_at = now() where id = v_invoice.id;
    v_sent := v_sent + 1;

    insert into audit_log (entity_type, entity_id, action, actor_id, metadata)
    values (
      'invoice', v_invoice.id, 'fee_reminder_sent', auth.uid(),
      jsonb_build_object('student_id', v_invoice.student_id, 'had_parent_recipient', v_had_recipient)
    );
  end loop;

  reminders_sent := v_sent;
  invoices_considered := v_considered;
  return next;
end;
$$;