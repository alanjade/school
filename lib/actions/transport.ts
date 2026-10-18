"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/actions/authGuards";
import type { TripDirection, TripStatusValue } from "@/types/database";
import { throwDbError } from "@/lib/errors/db";
import { runAction } from "@/lib/actionResult";

/** Admin or the transport officer — global, unlike the hostel version,
 * since there's normally just the one transport officer running the
 * whole fleet rather than one per route. */
async function assertCanManageTransport(): Promise<{ actorId: string }> {
  const { id } = await assertRole(
    ["admin", "teacher"],
    "Only an admin or the transport officer can do this."
  );
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", id).single();
  if (profile?.role === "admin") return { actorId: id };

  const { data: teacherProfile } = await admin
    .from("teacher_profiles")
    .select("staff_role")
    .eq("id", id)
    .single();
  if (teacherProfile?.staff_role !== "transport_officer") {
    throw new Error("Only an admin or the transport officer can do this.");
  }
  return { actorId: id };
}

/**
 * Narrower than assertCanManageTransport — used only for the two
 * things a driver is allowed to do (update trip status, share live
 * location), and only for whichever route their vehicle is currently
 * assigned to. Everything else in the module (routes, stops, student
 * assignments, vehicle reassignment) stays behind assertCanManageTransport.
 */
async function assertCanUpdateTrip(routeId: string): Promise<{ actorId: string }> {
  const { id } = await assertRole(
    ["admin", "teacher"],
    "Only an admin, the transport officer, or that route's driver can do this."
  );
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", id).single();
  if (profile?.role === "admin") return { actorId: id };

  const { data: teacherProfile } = await admin
    .from("teacher_profiles")
    .select("staff_role")
    .eq("id", id)
    .single();
  if (teacherProfile?.staff_role === "transport_officer") return { actorId: id };

  if (teacherProfile?.staff_role === "driver") {
    const { data: route } = await admin
      .from("transport_routes")
      .select("vehicle_id")
      .eq("id", routeId)
      .single();
    if (route?.vehicle_id) {
      const { data: vehicle } = await admin
        .from("vehicles")
        .select("driver_profile_id")
        .eq("id", route.vehicle_id)
        .single();
      if (vehicle?.driver_profile_id === id) return { actorId: id };
    }
  }

  throw new Error("Only an admin, the transport officer, or that route's driver can do this.");
}

// ---------- Admin: fleet setup ----------

export async function createVehicle(input: {
  plateNumber: string;
  model?: string;
  capacity: number;
  driverName?: string;
  driverPhone?: string;
}) {
  return runAction(async () => {
    await assertRole(["admin"], "Only an admin can add vehicles.");
    if (!input.plateNumber.trim()) throw new Error("Plate number is required.");
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      throw new Error("Capacity must be a whole number of at least 1.");
    }

    const admin = createAdminClient();
    const { error } = await admin.from("vehicles").insert({
      plate_number: input.plateNumber.trim(),
      model: input.model?.trim() || null,
      capacity: input.capacity,
      driver_name: input.driverName?.trim() || null,
      driver_phone: input.driverPhone?.trim() || null,
    });
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
  });
}

/**
 * Links a vehicle to an actual driver account (a teacher_profiles row
 * with staff_role = 'driver') so that person can log in and update
 * trip status / share live location for whichever route the vehicle is
 * on. Optional — a vehicle with no linked account still works exactly
 * as before, with the transport officer or admin updating status on
 * the driver's behalf via driver_name/driver_phone alone.
 */
export async function linkVehicleDriver(vehicleId: string, driverProfileId: string | null) {
  return runAction(async () => {
    await assertRole(["admin"], "Only an admin can link a driver account to a vehicle.");
    const admin = createAdminClient();

    if (driverProfileId) {
      const { data: teacherProfile } = await admin
        .from("teacher_profiles")
        .select("staff_role")
        .eq("id", driverProfileId)
        .single();
      if (teacherProfile?.staff_role !== "driver") {
        throw new Error("That account isn't set up with the driver staff role.");
      }
    }

    const { error } = await admin
      .from("vehicles")
      .update({ driver_profile_id: driverProfileId })
      .eq("id", vehicleId);
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
  });
}

export async function createRoute(input: {
  name: string;
  description?: string;
  vehicleId?: string;
}) {
  return runAction(async () => {
    await assertRole(["admin"], "Only an admin can create routes.");
    if (!input.name.trim()) throw new Error("Name is required.");

    const admin = createAdminClient();
    const { error } = await admin.from("transport_routes").insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      vehicle_id: input.vehicleId || null,
    });
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
  });
}

export async function createStop(input: {
  routeId: string;
  name: string;
  sequenceOrder: number;
  approxTime?: string;
}) {
  return runAction(async () => {
    await assertRole(["admin"], "Only an admin can add stops.");
    if (!input.name.trim()) throw new Error("Stop name is required.");

    const admin = createAdminClient();
    const { error } = await admin.from("transport_stops").insert({
      route_id: input.routeId,
      name: input.name.trim(),
      sequence_order: input.sequenceOrder,
      approx_time: input.approxTime || null,
    });
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
  });
}

export async function updateStop(input: { stopId: string; name: string; approxTime?: string }) {
  return runAction(async () => {
    await assertCanManageTransport();
    if (!input.name.trim()) throw new Error("Stop name is required.");

    const admin = createAdminClient();
    const { error } = await admin
      .from("transport_stops")
      .update({ name: input.name.trim(), approx_time: input.approxTime || null })
      .eq("id", input.stopId);
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
    revalidatePath("/dashboard/transport");
  });
}

/**
 * Swaps sequence_order with the adjacent stop rather than a full
 * drag-and-drop reorder — a route's stop list is short enough (a handful
 * of pickup points) that up/down arrows cover the actual need without
 * the extra client-side complexity a drag interface would add.
 */
export async function moveStop(stopId: string, direction: "up" | "down") {
  return runAction(async () => {
    await assertCanManageTransport();
    const admin = createAdminClient();

    const { data: stop } = await admin
      .from("transport_stops")
      .select("route_id, sequence_order")
      .eq("id", stopId)
      .single();
    if (!stop) throw new Error("Stop not found.");

    const { data: neighbor } = await admin
      .from("transport_stops")
      .select("id, sequence_order")
      .eq("route_id", stop.route_id)
      .eq("sequence_order", direction === "up" ? stop.sequence_order - 1 : stop.sequence_order + 1)
      .maybeSingle();
    if (!neighbor) return; // already at the top/bottom — nothing to do

    // Swap inside a single Postgres transaction via RPC so concurrent
    // moveStop() calls on the same route can't interleave and corrupt the
    // ordering. The old three-sequential-UPDATE approach had a race window
    // between reads and writes that this closes.
    // Migration: 20260806170200_swap_transport_stops_rpc.sql
    const { error } = await admin.rpc("swap_transport_stop_order", {
      p_stop_a: stopId,
      p_stop_b: neighbor.id,
    });
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
    revalidatePath("/dashboard/transport");
  });
}

export async function reassignRouteVehicle(routeId: string, vehicleId: string | null) {
  return runAction(async () => {
    const { id: actorId } = await assertRole(
      ["admin", "teacher"],
      "Only an admin or the transport officer can do this."
    );
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", actorId)
      .single();
    if (profile?.role !== "admin") {
      const { data: teacherProfile } = await admin
        .from("teacher_profiles")
        .select("staff_role")
        .eq("id", actorId)
        .single();
      if (teacherProfile?.staff_role !== "transport_officer") {
        throw new Error("Only an admin or the transport officer can do this.");
      }
    }

    // Close out the current history row for this route, if any.
    const { error: closeError } = await admin
      .from("route_vehicle_history")
      .update({ unassigned_at: new Date().toISOString() })
      .eq("route_id", routeId)
      .is("unassigned_at", null);
    if (closeError) throwDbError(closeError);

    if (vehicleId) {
      const { error: insertError } = await admin.from("route_vehicle_history").insert({
        route_id: routeId,
        vehicle_id: vehicleId,
        assigned_by: actorId,
      });
      if (insertError) throwDbError(insertError);
    }

    const { error: updateError } = await admin
      .from("transport_routes")
      .update({ vehicle_id: vehicleId })
      .eq("id", routeId);
    if (updateError) throwDbError(updateError);

    revalidatePath("/dashboard/admin/transport");
    revalidatePath("/dashboard/transport");
  });
}

// ---------- Admin or transport officer: assignments ----------

export async function assignStudentToRoute(input: {
  studentId: string;
  routeId: string;
  stopId: string;
  academicYear: string;
}) {
  return runAction(async () => {
    await assertCanManageTransport();

    // The route lock, capacity check, stop-belongs-to-route check,
    // close-old-assignment, and insert-new-assignment all happen inside
    // assign_student_to_route in one transaction — closes the race window
    // the old sequential app-side calls had (mirrors
    // assign_student_to_hostel_room for hostels).
    const { error } = await createClient().rpc("assign_student_to_route", {
      p_student_id: input.studentId,
      p_route_id: input.routeId,
      p_stop_id: input.stopId,
      p_academic_year: input.academicYear,
    });
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
  });
}

export async function unassignStudentFromRoute(assignmentId: string) {
  return runAction(async () => {
    await assertCanManageTransport();
    const admin = createAdminClient();

    const { error } = await admin
      .from("transport_assignments")
      .update({ unassigned_at: new Date().toISOString() })
      .eq("id", assignmentId)
      .is("unassigned_at", null);
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
  });
}

// ---------- Admin, transport officer, or that route's driver: live status ----------

export async function updateTripStatus(input: {
  routeId: string;
  tripDate: string;
  direction: TripDirection;
  status: TripStatusValue;
}) {
  return runAction(async () => {
    const { actorId } = await assertCanUpdateTrip(input.routeId);
    const admin = createAdminClient();

    const { error } = await admin.from("transport_trip_status").upsert(
      {
        route_id: input.routeId,
        trip_date: input.tripDate,
        direction: input.direction,
        status: input.status,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "route_id,trip_date,direction" }
    );
    if (error) throwDbError(error);

    revalidatePath("/dashboard/admin/transport");
    revalidatePath("/dashboard/transport");
  });
}

/**
 * Marks one student as boarded or dropped off for a specific trip
 * (route + date + direction). Distinct from updateTripStatus above —
 * that tracks the whole trip's state, this tracks individual students
 * within it, so a driver can confirm "this specific kid is on the bus"
 * rather than only "the bus has left."
 */
export async function markStudentPickup(input: {
  studentId: string;
  routeId: string;
  tripDate: string;
  direction: TripDirection;
  event: "picked_up" | "dropped_off";
}) {
  return runAction(async () => {
    const { actorId } = await assertCanUpdateTrip(input.routeId);
    const admin = createAdminClient();

    // Without this, a bogus studentId only ever surfaces as a raw
    // Postgres foreign-key-violation message from the upsert below
    // (transport_pickup_logs.student_id references student_profiles) --
    // not a data-integrity risk since the FK already blocks it, but an
    // ugly error rather than a clean one. More importantly, this also
    // catches a *valid* student id that just isn't assigned to *this*
    // route: assertCanUpdateTrip only authorizes the driver against the
    // route itself, not the student-route pairing, so without this a
    // driver could otherwise mark pickup/dropoff for any real student in
    // the system, not just the ones actually on their route.
    const { data: assignment } = await admin
      .from("transport_assignments")
      .select("id")
      .eq("student_id", input.studentId)
      .eq("route_id", input.routeId)
      .is("unassigned_at", null)
      .maybeSingle();
    if (!assignment) {
      throw new Error("That student isn't currently assigned to this route.");
    }

    const now = new Date().toISOString();
    const { error } =
      input.event === "picked_up"
        ? await admin.from("transport_pickup_logs").upsert(
            {
              student_id: input.studentId,
              route_id: input.routeId,
              trip_date: input.tripDate,
              direction: input.direction,
              picked_up_at: now,
              marked_by: actorId,
              updated_at: now,
            },
            { onConflict: "student_id,route_id,trip_date,direction" }
          )
        : await admin.from("transport_pickup_logs").upsert(
            {
              student_id: input.studentId,
              route_id: input.routeId,
              trip_date: input.tripDate,
              direction: input.direction,
              dropped_off_at: now,
              marked_by: actorId,
              updated_at: now,
            },
            { onConflict: "student_id,route_id,trip_date,direction" }
          );
    if (error) throwDbError(error);

    revalidatePath("/dashboard/driver");
    revalidatePath("/dashboard/admin/transport");
  });
}

/**
 * Records one GPS position update from the driver/transport officer's
 * phone during a trip. Deliberately a plain insert (append history)
 * rather than an upsert on "current position" — the read side only
 * ever wants the latest row anyway, and keeping history costs nothing
 * now while leaving room for a route-path view later without another
 * migration.
 */
export async function recordTransportLocation(input: {
  routeId: string;
  tripDate: string;
  direction: TripDirection;
  lat: number;
  lng: number;
}) {
  return runAction(async () => {
    const { actorId } = await assertCanUpdateTrip(input.routeId);
    if (
      !Number.isFinite(input.lat) ||
      !Number.isFinite(input.lng) ||
      Math.abs(input.lat) > 90 ||
      Math.abs(input.lng) > 180
    ) {
      throw new Error("Invalid coordinates.");
    }

    const admin = createAdminClient();
    const { error } = await admin.from("transport_locations").insert({
      route_id: input.routeId,
      trip_date: input.tripDate,
      direction: input.direction,
      lat: input.lat,
      lng: input.lng,
      recorded_by: actorId,
    });
    if (error) throwDbError(error);
  });
}
