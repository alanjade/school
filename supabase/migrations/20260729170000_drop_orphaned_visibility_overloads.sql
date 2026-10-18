-- Cleanup: CREATE OR REPLACE FUNCTION with an added/changed argument list
-- creates a new overload rather than replacing the old one. The two
-- previous migrations (student + parent week-visibility) each left the
-- original 2-arg version of these functions orphaned in the database.
-- Nothing calls them anymore (RLS policies and topic_note_visible were
-- rewritten to use the 5-arg versions) — this just removes the dead code
-- so a future migration can't accidentally call the unrestricted version.

begin;

drop function if exists public.topic_visible_to_student(education_level, integer);
drop function if exists public.topic_visible_to_parent(education_level, integer);

commit;
