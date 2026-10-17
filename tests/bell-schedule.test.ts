import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueueSupabaseMock, type MockResult } from "./helpers/supabaseMock";
import type { BellPeriod } from "@/types/database";

const { getUserWithRetry } = vi.hoisted(() => ({ getUserWithRetry: vi.fn() }));
const state = vi.hoisted(() => ({
  queue: [] as MockResult[],
  client: null as ReturnType<typeof createQueueSupabaseMock> | null,
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const writeAuditLog = vi.hoisted(() => vi.fn());

// One shared client for the session client and the service-role client
// (assertRole's profile lookup): the queue is positional.
const sharedClient = () => (state.client ??= createQueueSupabaseMock(state.queue));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => sharedClient()),
  getUserWithRetry,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => sharedClient()) }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ writeAuditLog }));

import {
  buildGridRows,
  countMismatchedEntries,
  findOverlap,
  hhmm,
  nextPeriodNumber,
} from "@/lib/bellSchedule";
import {
  deleteBellPeriod,
  saveBellPeriod,
  syncEntriesToBellSchedule,
} from "@/lib/actions/bellSchedule";

const bp = (
  id: string,
  period_number: number | null,
  label: string,
  start: string,
  end: string
): BellPeriod => ({
  id,
  period_number,
  label,
  is_break: period_number === null,
  start_time: `${start}:00`,
  end_time: `${end}:00`,
  created_at: "2026-10-17T00:00:00Z",
});

const day: BellPeriod[] = [
  bp("a", 1, "Period 1", "08:00", "08:40"),
  bp("b", 2, "Period 2", "08:45", "09:25"),
  bp("c", null, "Lunch", "09:25", "10:00"),
  bp("d", 3, "Period 3", "10:00", "10:40"),
];

describe("hhmm / nextPeriodNumber", () => {
  it("normalises DB and input times to HH:MM", () => {
    expect(hhmm("08:00:00")).toBe("08:00");
    expect(hhmm("08:00")).toBe("08:00");
  });

  it("finds the lowest unused lesson number, ignoring breaks", () => {
    expect(nextPeriodNumber([])).toBe(1);
    expect(nextPeriodNumber(day)).toBe(4);
    expect(
      nextPeriodNumber([bp("x", 1, "P1", "08:00", "08:40"), bp("y", 3, "P3", "09:00", "09:40")])
    ).toBe(2);
  });
});

describe("findOverlap", () => {
  const t = (s: string, e: string, id?: string) => ({ start_time: s, end_time: e, id });

  it("treats back-to-back periods as not overlapping", () => {
    expect(findOverlap(day, t("10:40", "11:20"))).toBeNull();
    expect(findOverlap(day, t("07:20", "08:00"))).toBeNull();
  });

  it("detects partial, containing and contained overlaps", () => {
    expect(findOverlap(day, t("08:30", "08:50"))?.id).toBe("a"); // straddles a/b boundary
    expect(findOverlap(day, t("07:00", "12:00"))).not.toBeNull(); // swallows the day
    expect(findOverlap(day, t("08:10", "08:20"))?.id).toBe("a"); // inside a period
  });

  it("ignores the row being edited", () => {
    expect(findOverlap(day, t("08:00", "08:35", "a"))).toBeNull();
    expect(findOverlap(day, t("08:00", "08:35", "z"))?.id).toBe("a");
  });
});

describe("countMismatchedEntries", () => {
  const e = (n: number, s: string, en: string) => ({
    period_number: n,
    start_time: `${s}:00`,
    end_time: `${en}:00`,
  });

  it("counts only lessons whose times disagree with their bell period", () => {
    const entries = [
      e(1, "08:00", "08:40"), // matches
      e(2, "10:00", "10:40"), // the live-DB case: period 2 at the wrong time
      e(2, "08:45", "09:25"), // matches
      e(9, "13:00", "13:40"), // not in bell schedule: nothing to disagree with
    ];
    expect(countMismatchedEntries(day, entries)).toBe(1);
  });

  it("is zero with no bell schedule", () => {
    expect(countMismatchedEntries([], [e(1, "08:00", "08:40")])).toBe(0);
  });
});

describe("buildGridRows", () => {
  const e = (n: number, s: string, en: string) => ({
    period_number: n,
    start_time: `${s}:00`,
    end_time: `${en}:00`,
  });

  it("with no bell schedule keeps the original behaviour: one row per used period, by number", () => {
    const rows = buildGridRows(
      [],
      [e(3, "10:00", "10:40"), e(1, "08:00", "08:40"), e(3, "10:00", "10:40")]
    );
    expect(rows.map((r) => (r.kind === "lesson" ? r.periodNumber : "break"))).toEqual([1, 3]);
    expect(rows.every((r) => r.kind === "lesson" && !r.inBellSchedule)).toBe(true);
  });

  it("with a bell schedule shows every period, even empty ones, and breaks in order", () => {
    const rows = buildGridRows(day, [e(1, "08:00", "08:40")]);
    expect(rows.map((r) => r.key)).toEqual(["p1", "p2", "bc", "p3"]);
    expect(rows[2]).toMatchObject({
      kind: "break",
      label: "Lunch",
      startTime: "09:25",
      endTime: "10:00",
    });
  });

  it("keeps lessons in an unknown period visible, flagged, in clock order", () => {
    const rows = buildGridRows(day, [e(7, "09:30", "10:00")]);
    const seven = rows.find((r) => r.key === "p7");
    expect(seven).toMatchObject({ kind: "lesson", inBellSchedule: false, startTime: "09:30" });
    // 09:30 falls after Lunch (09:25) and before Period 3 (10:00)
    expect(rows.map((r) => r.key)).toEqual(["p1", "p2", "bc", "p7", "p3"]);
  });

  it("orders by clock time rather than period number when they disagree", () => {
    const odd = [
      bp("x", 2, "Period 2", "07:00", "07:40"),
      bp("y", 1, "Period 1", "08:00", "08:40"),
    ];
    expect(buildGridRows(odd, []).map((r) => r.key)).toEqual(["p2", "p1"]);
  });
});

// ---------------------------------------------------------------- actions

function mockAuthenticatedAs(userId: string) {
  getUserWithRetry.mockResolvedValue({ user: { id: userId }, error: null, isTransient: false });
}
const asAdmin: MockResult = { data: { role: "admin", is_active: true }, error: null };
const asTeacher: MockResult = { data: { role: "teacher", is_active: true }, error: null };
const rows = (data: unknown): MockResult => ({ data, error: null });
const ok: MockResult = { data: null, error: null };

const existing = [
  {
    id: "a",
    period_number: 1,
    label: "Period 1",
    is_break: false,
    start_time: "08:00:00",
    end_time: "08:40:00",
  },
  {
    id: "b",
    period_number: 2,
    label: "Period 2",
    is_break: false,
    start_time: "08:45:00",
    end_time: "09:25:00",
  },
];

afterEach(() => {
  vi.clearAllMocks();
  state.queue = [];
  state.client = null;
});

describe("saveBellPeriod", () => {
  const lesson = { isBreak: false, periodNumber: 3, startTime: "09:30", endTime: "10:10" };

  it("refuses anyone who isn't an admin, before reading or writing the schedule", async () => {
    mockAuthenticatedAs("teacher-1");
    state.queue = [asTeacher];
    const result = await saveBellPeriod(lesson);
    expect(result).toEqual({ ok: false, error: "Only an admin can edit the bell schedule." });
    // only assertRole's profile lookup ran; bell_periods was never touched
    expect(state.client!.from.mock.calls).toEqual([["profiles"]]);
  });

  it("rejects an end time that isn't after the start", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [asAdmin];
    const result = await saveBellPeriod({ ...lesson, startTime: "10:00", endTime: "10:00" });
    expect(result).toEqual({ ok: false, error: "End time must be after start time." });
  });

  it("requires a name for a break, and a whole period number for a lesson", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [asAdmin];
    expect(await saveBellPeriod({ isBreak: true, startTime: "10:00", endTime: "10:20" })).toEqual({
      ok: false,
      error: "Give the break a name (e.g. Lunch).",
    });

    state.client = null;
    state.queue = [asAdmin];
    expect(await saveBellPeriod({ ...lesson, periodNumber: 1.5 })).toMatchObject({ ok: false });

    state.client = null;
    state.queue = [asAdmin];
    expect(await saveBellPeriod({ ...lesson, periodNumber: 0 })).toMatchObject({ ok: false });
  });

  it("rejects a duplicate period number", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [asAdmin, rows(existing)];
    const result = await saveBellPeriod({ ...lesson, periodNumber: 2 });
    expect(result).toEqual({ ok: false, error: "Period 2 is already in the bell schedule." });
  });

  it("rejects an overlap and names what it collides with", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [asAdmin, rows(existing)];
    const result = await saveBellPeriod({ ...lesson, startTime: "09:00", endTime: "09:40" });
    expect(result).toEqual({ ok: false, error: "That overlaps with Period 2 (08:45–09:25)." });
  });

  it("creates a lesson period, defaulting the name, and audits it", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [asAdmin, rows(existing), rows({ id: "new-1" })];
    const result = await saveBellPeriod(lesson);
    expect(result).toEqual({ ok: true });
    // call 0: profiles (assertRole), 1: list, 2: insert
    const insertBuilder = state.client!.from.mock.results[2].value;
    expect(insertBuilder.insert).toHaveBeenCalledWith({
      period_number: 3,
      label: "Period 3",
      is_break: false,
      start_time: "09:30",
      end_time: "10:10",
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "new-1",
        action: "bell_period_created",
        actorId: "admin-1",
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/admin/bell-schedule");
  });

  it("creates a break with no period number", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [asAdmin, rows(existing), rows({ id: "new-2" })];
    const result = await saveBellPeriod({
      isBreak: true,
      periodNumber: 99, // must be ignored for a break
      label: "  Lunch ",
      startTime: "09:25:00",
      endTime: "10:00:00",
    });
    expect(result).toEqual({ ok: true });
    expect(state.client!.from.mock.results[2].value.insert).toHaveBeenCalledWith({
      period_number: null,
      label: "Lunch",
      is_break: true,
      start_time: "09:25",
      end_time: "10:00",
    });
  });

  it("lets a period be edited without colliding with itself", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [asAdmin, rows(existing), ok];
    const result = await saveBellPeriod({
      id: "a",
      isBreak: false,
      periodNumber: 1, // same number as itself: not a duplicate
      startTime: "08:00",
      endTime: "08:35", // still overlaps only itself
    });
    expect(result).toEqual({ ok: true });
    expect(state.client!.from.mock.results[2].value.update).toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "a", action: "bell_period_updated" })
    );
  });
});

describe("deleteBellPeriod", () => {
  it("is admin-only", async () => {
    mockAuthenticatedAs("teacher-1");
    state.queue = [asTeacher];
    expect(await deleteBellPeriod("a")).toMatchObject({ ok: false });
    // only assertRole's profile lookup ran; bell_periods was never touched
    expect(state.client!.from.mock.calls).toEqual([["profiles"]]);
  });

  it("deletes and audits", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [asAdmin, ok];
    expect(await deleteBellPeriod("a")).toEqual({ ok: true });
    expect(state.client!.from.mock.results[1].value.delete).toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "a", action: "bell_period_deleted" })
    );
  });
});

describe("syncEntriesToBellSchedule", () => {
  it("is admin-only", async () => {
    mockAuthenticatedAs("teacher-1");
    state.queue = [asTeacher];
    expect(await syncEntriesToBellSchedule()).toMatchObject({ ok: false });
  });

  it("updates only mismatched lessons per period and reports the total", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [
      asAdmin,
      rows([
        { period_number: 1, start_time: "08:00:00", end_time: "08:40:00" },
        { period_number: 2, start_time: "08:45:00", end_time: "09:25:00" },
      ]),
      rows([]), // period 1: nothing differs
      rows([{ id: "e1" }, { id: "e2" }]), // period 2: two lessons fixed
    ];
    const result = await syncEntriesToBellSchedule();
    expect(result).toEqual({ ok: true, data: { updated: 2 } });

    const p2 = state.client!.from.mock.results[3].value;
    expect(p2.update).toHaveBeenCalledWith({ start_time: "08:45:00", end_time: "09:25:00" });
    expect(p2.eq).toHaveBeenCalledWith("period_number", 2);
    expect(p2.or).toHaveBeenCalledWith("start_time.neq.08:45:00,end_time.neq.09:25:00");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "timetable_synced_to_bell_schedule",
        metadata: { updated: 2 },
      })
    );
  });

  it("doesn't write an audit entry when nothing changed", async () => {
    mockAuthenticatedAs("admin-1");
    state.queue = [
      asAdmin,
      rows([{ period_number: 1, start_time: "08:00:00", end_time: "08:40:00" }]),
      rows([]),
    ];
    expect(await syncEntriesToBellSchedule()).toEqual({ ok: true, data: { updated: 0 } });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
