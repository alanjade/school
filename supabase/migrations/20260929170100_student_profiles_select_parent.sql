-- The parent dashboard and lib/parent.ts's getLinkedChildren() load a
-- child's name and class through guardian_links -> student_profiles ->
-- profiles / classes. student_profiles_select only allows the student
-- themselves, admins and teachers, so for a parent the student_profiles
-- row comes back null and everything nested under it falls back to
-- "Unknown". profiles_select_parent (2026_09_29) is correct but is never
-- reached without this. Same is_parent_of() pattern as the other
-- student-linked tables.
drop policy if exists student_profiles_select_parent on student_profiles;
create policy student_profiles_select_parent on student_profiles for select to public
  using (is_parent_of(id));
