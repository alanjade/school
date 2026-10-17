import type { BellPeriod } from "@/types/database";

/**
 * Pure helpers for the school bell schedule. No I/O so they can be unit
 * tested and shared by the admin editor, the server actions and the
 * class-timetable grid.
 *
 * Times are plain wall-clock strings. The database returns `time` columns
 * as "HH:MM:SS" and <input type="time"> produces "HH:MM", so everything
 * here compares on the normalised "HH:MM" form (see hhmm).
 */

type TimeRange = { start_time: string; end_time: string };

/** "08:00:00" -> "08:00". Idempotent, so safe on either input shape. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

export function toMinutes(time: string): number {
  const [h, m] = hhmm(time).split(":").map(Number);
  return h * 60 + m;
}

export function defaultPeriodLabel(periodNumber: number): string {
  return `Period ${periodNumber}`;
}

/**
 * The first existing bell period whose time range overlaps `candidate`,
 * or null. Back-to-back periods (one ends exactly when the next starts)
 * do not overlap. Pass `candidate.id` when editing so a row is never
 * reported as overlapping itself.
 */
export function findOverlap<T extends TimeRange & { id: string }>(
  existing: T[],
  candidate: TimeRange & { id?: string }
): T | null {
  const start = toMinutes(candidate.start_time);
  const end = toMinutes(candidate.end_time);
  return (
    existing.find(
      (p) => p.id !== candidate.id && start < toMinutes(p.end_time) && toMinutes(p.start_time) < end
    ) ?? null
  );
}

/** Lowest unused lesson period number, for pre-filling the "add period" form. */
export function nextPeriodNumber(periods: Pick<BellPeriod, "period_number">[]): number {
  const used = new Set(periods.map((p) => p.period_number).filter((n): n is number => n !== null));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

type EntryTimes = { period_number: number; start_time: string; end_time: string };

/**
 * How many existing timetable entries have times that disagree with the
 * bell schedule for their period. Entries whose period isn't in the bell
 * schedule at all aren't counted: there's nothing to disagree with.
 */
export function countMismatchedEntries(bell: BellPeriod[], entries: EntryTimes[]): number {
  const byNumber = new Map(
    bell.filter((p) => !p.is_break && p.period_number !== null).map((p) => [p.period_number, p])
  );
  let count = 0;
  for (const e of entries) {
    const p = byNumber.get(e.period_number);
    if (p && (hhmm(p.start_time) !== hhmm(e.start_time) || hhmm(p.end_time) !== hhmm(e.end_time))) {
      count += 1;
    }
  }
  return count;
}

export type GridRow =
  | {
      kind: "lesson";
      key: string;
      periodNumber: number;
      label: string;
      startTime: string;
      endTime: string;
      /** False when lessons exist for this period number but the bell schedule has no such period. */
      inBellSchedule: boolean;
    }
  | { kind: "break"; key: string; label: string; startTime: string; endTime: string };

/**
 * The rows of a class's weekly grid, top to bottom.
 *
 * With no bell schedule this reproduces the grid's original behaviour
 * exactly: one row per period number that has a lesson, ordered by
 * number. With one, every bell period gets a row even when nothing is
 * scheduled in it yet, breaks appear between lessons, and rows are
 * ordered by clock time. Lessons in a period the bell schedule doesn't
 * know about still get a row (flagged inBellSchedule: false) so they
 * never silently vanish from the grid.
 */
export function buildGridRows(bell: BellPeriod[], entries: EntryTimes[]): GridRow[] {
  if (!bell.length) {
    return [...new Set(entries.map((e) => e.period_number))]
      .sort((a, b) => a - b)
      .map((n) => {
        const first = entries.find((e) => e.period_number === n)!;
        return {
          kind: "lesson" as const,
          key: `p${n}`,
          periodNumber: n,
          label: defaultPeriodLabel(n),
          startTime: hhmm(first.start_time),
          endTime: hhmm(first.end_time),
          inBellSchedule: false,
        };
      });
  }

  const rows: GridRow[] = [];
  const known = new Set<number>();

  for (const p of bell) {
    if (p.is_break || p.period_number === null) {
      rows.push({
        kind: "break",
        key: `b${p.id}`,
        label: p.label,
        startTime: hhmm(p.start_time),
        endTime: hhmm(p.end_time),
      });
    } else {
      known.add(p.period_number);
      rows.push({
        kind: "lesson",
        key: `p${p.period_number}`,
        periodNumber: p.period_number,
        label: p.label,
        startTime: hhmm(p.start_time),
        endTime: hhmm(p.end_time),
        inBellSchedule: true,
      });
    }
  }

  const unknown = [...new Set(entries.map((e) => e.period_number).filter((n) => !known.has(n)))];
  for (const n of unknown) {
    // Earliest-starting lesson in that period stands in for its time.
    const first = entries
      .filter((e) => e.period_number === n)
      .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time))[0];
    rows.push({
      kind: "lesson",
      key: `p${n}`,
      periodNumber: n,
      label: defaultPeriodLabel(n),
      startTime: hhmm(first.start_time),
      endTime: hhmm(first.end_time),
      inBellSchedule: false,
    });
  }

  return rows.sort((a, b) => {
    const byTime = toMinutes(a.startTime) - toMinutes(b.startTime);
    if (byTime !== 0) return byTime;
    // Same start (e.g. an off-schedule lesson at a bell time): lesson rows
    // by period number, with a break after the lesson it ties with.
    if (a.kind === "lesson" && b.kind === "lesson") return a.periodNumber - b.periodNumber;
    return a.kind === "lesson" ? -1 : 1;
  });
}
