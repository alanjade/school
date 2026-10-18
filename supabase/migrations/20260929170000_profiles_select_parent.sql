-- Every other student-linked table (attendance, invoices, grades,
-- quiz_attempts/answers, library_loans, payments, transport, hostel,
-- installment_plans, report cards...) already has an is_parent_of()
-- SELECT policy so a parent can see their own child's data. profiles
-- never got one, even though it's the table holding the child's own
-- full_name/role -- so profiles_select_own_or_admin (self or admin)
-- and profiles_select_staff (any teacher) leave a parent with no
-- row-level access to their child's profile at all. That's why every
-- parent-facing page showing a child's name (lib/parent.ts's
-- getLinkedChildren, the dashboard digest, etc.) falls back to
-- "Unknown" -- not because those queries are wrong, but because RLS
-- silently returns nothing for the embedded profiles(full_name) join.
create policy profiles_select_parent on profiles for select to public
  using (is_parent_of(id));
