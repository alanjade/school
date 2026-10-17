import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BellScheduleEditor } from "@/components/BellScheduleEditor";
import { countMismatchedEntries } from "@/lib/bellSchedule";

export default async function BellSchedulePage() {
  const supabase = createClient();

  const { data: periods } = await supabase
    .from("bell_periods")
    .select("*")
    .order("start_time", { ascending: true });

  const { data: entries } = await supabase
    .from("timetable_entries")
    .select("period_number, start_time, end_time");

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Bell schedule</h1>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          The school day&apos;s periods and breaks. Class timetables take their times from here.
        </p>
        <Link
          href="/dashboard/admin/timetables"
          className="rounded-lg border border-leaf px-4 py-2 text-sm font-medium text-leaf hover:bg-leaf-soft"
        >
          Class timetables
        </Link>
      </div>

      <BellScheduleEditor
        periods={periods ?? []}
        mismatchCount={countMismatchedEntries(periods ?? [], entries ?? [])}
      />
    </div>
  );
}
