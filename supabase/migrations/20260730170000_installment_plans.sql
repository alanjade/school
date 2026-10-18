-- Installment plans for fees.
--
-- Deliberately additive and read-only from the existing payment
-- pipeline's point of view: invoices.total_amount_kobo /
-- invoices.discount_kobo / invoices.amount_paid_kobo / invoices.status
-- and record_invoice_payment() are completely untouched. An installment
-- plan is a *schedule* that breaks an invoice's net payable amount into
-- due-dated chunks for display/reminder purposes -- the actual ledger
-- (what's been paid) stays exactly as it already worked. Which
-- installment(s) a given payment "counts against" is derived at read
-- time by allocating amount_paid_kobo across installments in due-date
-- order (see lib/installments.ts), not stored -- so there's no second
-- source of truth that payments could ever drift out of sync with.

begin;

create table public.invoice_installments (
  id uuid not null default gen_random_uuid(),
  invoice_id uuid not null,
  sequence_order integer not null,
  due_date date not null,
  amount_kobo bigint not null,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  constraint invoice_installments_pkey primary key (id),
  constraint invoice_installments_invoice_id_fkey foreign key (invoice_id) references public.invoices(id),
  constraint invoice_installments_created_by_fkey foreign key (created_by) references public.profiles(id),
  constraint invoice_installments_amount_positive check (amount_kobo > 0),
  constraint invoice_installments_invoice_sequence_unique unique (invoice_id, sequence_order)
);

alter table public.invoice_installments enable row level security;

-- Same visibility set invoices already use (self, parent, admin,
-- bursar) -- reuses the existing is_parent_of()/is_admin()/is_bursar()
-- helpers rather than inventing new ones.
create policy invoice_installments_select on public.invoice_installments for select to public
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_installments.invoice_id
        and (i.student_id = auth.uid() or is_parent_of(i.student_id) or is_admin() or is_bursar())
    )
  );

create policy invoice_installments_write on public.invoice_installments for all to public
  using (is_admin() or is_bursar())
  with check (is_admin() or is_bursar());

commit;
