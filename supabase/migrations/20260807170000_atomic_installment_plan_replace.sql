-- createOrReplaceInstallmentPlan() (lib/actions/installments.ts) did a
-- delete of every existing row for the invoice, then a separate insert
-- of the new rows, as two independent Supabase calls -- not one
-- transaction. If the delete succeeded and the insert then failed for
-- any reason (network blip, a constraint violation on one row), the
-- invoice was left with an empty installment plan and no rollback: the
-- old schedule is gone, the new one never landed.
--
-- Wrapping both steps in one plpgsql function makes them atomic -- a
-- Postgres function body runs inside a single transaction, so an
-- exception partway through (including the amount-sum check below)
-- rolls back the delete along with everything else.
create or replace function replace_invoice_installments(
  p_invoice_id uuid,
  p_created_by uuid,
  -- [{ "due_date": "2026-09-01", "amount_kobo": 500000 }, ...]
  -- Validation of shape (due date present, amount positive integer) and
  -- the "matches at least 2 installments" rule stays in
  -- createOrReplaceInstallmentPlan() -- this function assumes that's
  -- already been checked and only re-validates the one thing that's
  -- unsafe to trust from the caller: that the amounts actually sum to
  -- the invoice's net payable total, since that's the only part that
  -- needs a fresh read of the invoice row to verify.
  p_installments jsonb
)
returns void
language plpgsql
as $$
declare
  v_invoice invoices;
  v_net_payable_kobo bigint;
  v_schedule_total_kobo bigint;
  v_item jsonb;
  v_index int := 0;
begin
  select * into v_invoice from invoices where id = p_invoice_id;
  if v_invoice.id is null then
    raise exception 'Invoice not found.';
  end if;
  if v_invoice.voided_at is not null then
    raise exception 'This invoice has been voided.';
  end if;

  v_net_payable_kobo := v_invoice.total_amount_kobo - v_invoice.discount_kobo;

  select coalesce(sum((item->>'amount_kobo')::bigint), 0) into v_schedule_total_kobo
  from jsonb_array_elements(p_installments) as item;

  if v_schedule_total_kobo <> v_net_payable_kobo then
    raise exception
      'The installments add up to %, but the invoice''s net payable amount (after any discount) is %. They must match exactly.',
      v_schedule_total_kobo, v_net_payable_kobo;
  end if;

  delete from invoice_installments where invoice_id = p_invoice_id;

  -- jsonb_array_elements does not guarantee array order is preserved
  -- through a plain iteration in all Postgres versions/plans -- order by
  -- the element's own due_date (mirrors the .sort() the caller already
  -- did before serializing) so sequence_order still means "due soonest
  -- first" regardless of iteration order.
  for v_item in
    select * from jsonb_array_elements(p_installments)
    order by (value->>'due_date')
  loop
    v_index := v_index + 1;
    insert into invoice_installments (invoice_id, sequence_order, due_date, amount_kobo, created_by)
    values (
      p_invoice_id,
      v_index,
      (v_item->>'due_date')::date,
      (v_item->>'amount_kobo')::bigint,
      p_created_by
    );
  end loop;
end;
$$;
