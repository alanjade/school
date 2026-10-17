import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatLevel } from "@/types/database";

export default async function AdminTimetablesPage() {
  const supabase = createClient();

  const { data: classes } = await supabase
    .from("classes")
    .select("*")
    .order("education_level", { ascending: true })
    .order("level_number", { ascending: true })
    .order("arm", { ascending: true });

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Timetables</h1>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Select a class to view or build its weekly schedule.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/admin/bell-schedule"
            className="rounded-lg border border-leaf px-4 py-2 text-sm font-medium text-leaf hover:bg-leaf-soft"
          >
            Bell schedule
          </Link>
          <Link
            href="/dashboard/admin/timetables/teachers"
            className="rounded-lg border border-leaf px-4 py-2 text-sm font-medium text-leaf hover:bg-leaf-soft"
          >
            Teacher schedule view
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {classes?.map((cls) => (
          <Link
            key={cls.id}
            href={`/dashboard/admin/timetables/${cls.id}`}
            className="rounded-xl border border-rule bg-white p-5 transition hover:border-leaf"
          >
            <p className="font-display text-lg font-semibold text-ink">
              {cls.name} {cls.arm}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {formatLevel(cls.education_level, cls.level_number)} · {cls.academic_year}
            </p>
          </Link>
        ))}

        {!classes?.length && (
          <p className="col-span-full text-sm text-ink-soft">No classes yet — create one first.</p>
        )}
      </div>
    </div>
  );
}
