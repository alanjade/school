"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/actions/authGuards";
import { writeAuditLog } from "@/lib/audit";
import { throwDbError } from "@/lib/errors/db";
import { runAction } from "@/lib/actionResult";
import { defaultPeriodLabel, findOverlap, hhmm } from "@/lib/bellSchedule";

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const MAX_PERIOD_NUMBER = 20;

function revalidateTimetables() {
  revalidatePath("/dashboard/admin/bell-schedule");
  // The class grids and entry forms read the bell schedule too.
  revalidatePath("/dashboard/admin/timetables", "layout");
}

/**
 * Creates a bell period (when `id` is omitted) or updates one.
 *
 * A "lesson" has a period number (the same number timetable_entries uses);
 * a "break" has none and just needs a name. Rejects, with a message the
 * admin can act on: a bad time range, a duplicate period number, or any
 * overlap with another period or break. Editing a period does NOT touch
 * existing timetable lessons -- see syncEntriesToBellSchedule.
 */
export async function saveBellPeriod(input: {
  id?: string;
  isBreak: boolean;
  periodNumber?: number | null;
  label?: string;
  startTime: string;
  endTime: string;
}) {
  return runAction(async () => {
    const actor = await assertRole(["admin"], "Only an admin can edit the bell schedule.");

    if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) {
      throw new Error("Enter a start and end time.");
    }
    const start = hhmm(input.startTime);
    const end = hhmm(input.endTime);
    if (end <= start) throw new Error("End time must be after start time.");

    let periodNumber: number | null = null;
    let label = input.label?.trim() ?? "";

    if (input.isBreak) {
      if (!label) throw new Error("Give the break a name (e.g. Lunch).");
    } else {
      const n = input.periodNumber;
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > MAX_PERIOD_NUMBER) {
        throw new Error(`Period number must be a whole number from 1 to ${MAX_PERIOD_NUMBER}.`);
      }
      periodNumber = n as number;
      if (!label) label = defaultPeriodLabel(periodNumber);
    }

    const supabase = createClient();

    const { data: existing, error: listError } = await supabase
      .from("bell_periods")
      .select("id, period_number, label, is_break, start_time, end_time");
    if (listError) throwDbError(listError);
    const others = (existing ?? []).filter((p) => p.id !== input.id);

    if (periodNumber !== null && others.some((p) => p.period_number === periodNumber)) {
      throw new Error(`Period ${periodNumber} is already in the bell schedule.`);
    }

    const clash = findOverlap(others, { start_time: start, end_time: end });
    if (clash) {
      throw new Error(
        `That overlaps with ${clash.label} (${hhmm(clash.start_time)}–${hhmm(clash.end_time)}).`
      );
    }

    const row = {
      period_number: periodNumber,
      label,
      is_break: input.isBreak,
      start_time: start,
      end_time: end,
    };

    let entityId = input.id;
    if (input.id) {
      const { error } = await supabase.from("bell_periods").update(row).eq("id", input.id);
      if (error) throwDbError(error);
    } else {
      const { data, error } = await supabase.from("bell_periods").insert(row).select("id").single();
      if (error) throwDbError(error);
      entityId = data?.id;
    }

    if (entityId) {
      await writeAuditLog({
        entityType: "bell_period",
        entityId,
        action: input.id ? "bell_period_updated" : "bell_period_created",
        actorId: actor.id,
        metadata: row,
      });
    }

    revalidateTimetables();
  });
}

/**
 * Removes a bell period or break. Lessons already scheduled in that
 * period are left alone: they keep their own times and simply show as
 * "not in bell schedule" on the class grid.
 */
export async function deleteBellPeriod(id: string) {
  return runAction(async () => {
    const actor = await assertRole(["admin"], "Only an admin can edit the bell schedule.");

    const supabase = createClient();
    const { error } = await supabase.from("bell_periods").delete().eq("id", id);
    if (error) throwDbError(error);

    await writeAuditLog({
      entityType: "bell_period",
      entityId: id,
      action: "bell_period_deleted",
      actorId: actor.id,
    });

    revalidateTimetables();
  });
}

/**
 * Rewrites the start/end time of every existing timetable lesson whose
 * period has a bell period, across all classes, terms and years, so they
 * match the bell schedule. Only rows that actually differ are touched,
 * and only their times: no lesson is added, moved or removed, and the
 * class/teacher/room uniqueness rules (keyed on period number) can't be
 * affected. Returns how many lessons changed.
 *
 * This is an explicit action rather than a side effect of editing the
 * bell schedule so that changing next term's bells never silently
 * rewrites the times on timetables someone already published.
 */
export async function syncEntriesToBellSchedule() {
  return runAction(async () => {
    const actor = await assertRole(["admin"], "Only an admin can edit the bell schedule.");

    const supabase = createClient();
    const { data: periods, error: listError } = await supabase
      .from("bell_periods")
      .select("period_number, start_time, end_time")
      .eq("is_break", false);
    if (listError) throwDbError(listError);

    let updated = 0;
    for (const p of periods ?? []) {
      if (p.period_number === null) continue;
      const { data, error } = await supabase
        .from("timetable_entries")
        .update({ start_time: p.start_time, end_time: p.end_time })
        .eq("period_number", p.period_number)
        .or(`start_time.neq.${p.start_time},end_time.neq.${p.end_time}`)
        .select("id");
      if (error) throwDbError(error);
      updated += data?.length ?? 0;
    }

    if (updated > 0) {
      await writeAuditLog({
        entityType: "bell_period",
        entityId: actor.id,
        action: "timetable_synced_to_bell_schedule",
        actorId: actor.id,
        metadata: { updated },
      });
    }

    revalidateTimetables();
    return { updated };
  });
}
