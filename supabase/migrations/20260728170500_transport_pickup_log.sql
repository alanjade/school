-- Migration: per-student pickup/drop-off marking for transport trips.
--
-- transport_trip_status already tracks whole-trip state (not_started /
-- en_route / arrived) per route+date+direction, but nothing tracks
-- whether any INDIVIDUAL student actually boarded or was dropped off —
-- a driver currently has no way to confirm "this specific kid is on the
-- bus" beyond the whole-trip status. This adds that, following the same
-- upsert-per-key shape transport_trip_status already uses.

begin;

CREATE TABLE public.transport_pickup_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.student_profiles(id),
  route_id uuid NOT NULL REFERENCES public.transport_routes(id),
  trip_date date NOT NULL,
  direction text NOT NULL,
  picked_up_at timestamp with time zone,
  dropped_off_at timestamp with time zone,
  marked_by uuid REFERENCES public.profiles(id),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (student_id, route_id, trip_date, direction)
);

ALTER TABLE public.transport_pickup_logs ENABLE ROW LEVEL SECURITY;

-- Same visibility shape as transport_assignments: the student themself,
-- their parent, admin, transport officer, or that route's driver.
CREATE POLICY transport_pickup_logs_select ON public.transport_pickup_logs FOR SELECT TO public
  USING (
    is_self_student(student_id)
    OR is_parent_of(student_id)
    OR is_admin()
    OR is_transport_officer()
    OR is_driver_of_route(route_id)
  );

-- Write access matches assertCanUpdateTrip()'s existing logic exactly
-- (admin, transport officer, or that route's own driver) — enforced at
-- the app layer already via assertCanUpdateTrip, this RLS policy is
-- defense-in-depth for the same rule.
CREATE POLICY transport_pickup_logs_write ON public.transport_pickup_logs FOR ALL TO public
  USING (is_admin() OR is_transport_officer() OR is_driver_of_route(route_id))
  WITH CHECK (is_admin() OR is_transport_officer() OR is_driver_of_route(route_id));

commit;