-- Two fixes found while confirming 20260728180000_outstanding_review_fixes.sql
-- landed correctly:

begin;

-- 1. BUG FIX: invoices_exactly_one_fee_source is stale and contradicts
--    invoices_exactly_one_fee_structure. It only checks
--    fee_structure_id/transport_fee_structure_id and never mentions
--    hostel_fee_structure_id, so it rejects EVERY hostel-fee invoice
--    (fee_structure_id NULL, transport_fee_structure_id NULL,
--    hostel_fee_structure_id NOT NULL matches neither of its branches).
--    invoices_exactly_one_fee_structure (num_nonnulls(...) = 1) is the
--    correct, current version of this rule and already covers all three
--    fee-source columns — drop the stale one so hostel invoicing
--    (billHostelResidents() in lib/actions/hostelFees.ts) stops failing.
alter table public.invoices
  drop constraint if exists invoices_exactly_one_fee_source;

-- 2. Cleanup: drop the exact-duplicate constraints this session's
--    2026_07_29b_enrollment_guardian_invoice_constraints.sql added,
--    now that a live dump confirms equivalent constraints already
--    existed under different names (enrollments_unique_student_term,
--    guardian_links_parent_id_student_id_key /
--    guardian_links_unique_parent_student). Keeping three constraints
--    that enforce the exact same rule is harmless but confusing.
alter table public.enrollments
  drop constraint if exists enrollments_student_year_term_key;

alter table public.guardian_links
  drop constraint if exists guardian_links_parent_student_key;

commit;
