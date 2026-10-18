import { createClient } from "@/lib/supabase/server";
import { getLinkedChildren, resolveSelectedChild } from "@/lib/parent";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { homeworkDisplayStatus, homeworkDueStatus } from "@/types/database";
import { HomeworkStatusBadge } from "@/components/HomeworkStatusBadge";

function dueLabel(dueAt: string, status: ReturnType<typeof homeworkDueStatus>): string {
  const formatted = new Date(`${dueAt}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  if (status === "overdue") return `Overdue — was due ${formatted}`;
  if (status === "due_today") return "Due today";
  return `Due ${formatted}`;
}

export default async function ParentHomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const resolvedSearchParams = await searchParams;

  const children = await getLinkedChildren();
  const selected = await resolveSelectedChild(resolvedSearchParams.child);

  if (!selected) {
    return <p className="text-sm text-ink-soft">No children linked to your account.</p>;
  }

  const supabase = createClient();

  const { data: studentProfile } = await supabase
    .from("student_profiles")
    .select("class_id")
    .eq("id", selected.id)
    .single();

  const { data: lessons } = await supabase
    .from("lessons")
    .select(
      "id, lesson_date, homework, homework_status, homework_due_at, timetable_entries(subjects(name)), homework_submissions(status, student_id)"
    )
    .eq("class_id", studentProfile?.class_id ?? "")
    // A parent can read every linked child's submissions, so narrow the
    // embedded rows to the child being viewed (siblings share lessons).
    .eq("homework_submissions.student_id", selected.id)
    .not("homework", "is", null)
    .order("lesson_date", { ascending: false })
    .limit(30);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Homework</h1>
      <ChildSwitcher linkedChildren={children} selectedChildId={selected.id} />

      <div className="space-y-2">
        {lessons?.map((l) => (
          <div key={l.id} className="rounded-lg border border-rule bg-white p-4">
            <div className="mb-1 flex items-center justify-between gap-3">
              <p className="font-medium text-ink">
                {l.timetable_entries?.subjects?.name ?? "Lesson"}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-ink-soft">{l.lesson_date}</span>
                <HomeworkStatusBadge
                  status={homeworkDisplayStatus(
                    l.homework_status,
                    l.homework_submissions?.[0]?.status
                  )}
                />
              </div>
            </div>
            {l.homework_due_at &&
              (() => {
                if (
                  homeworkDisplayStatus(l.homework_status, l.homework_submissions?.[0]?.status) !==
                  "given"
                )
                  return null;
                const status = homeworkDueStatus(l);
                if (status === "none") return null;
                return (
                  <p
                    className={`mb-1 text-xs font-medium ${
                      status === "overdue"
                        ? "text-clay"
                        : status === "due_today" || status === "due_soon"
                          ? "text-marigold-text"
                          : "text-ink-soft"
                    }`}
                  >
                    {dueLabel(l.homework_due_at, status)}
                  </p>
                );
              })()}
            <p className="text-sm text-ink">{l.homework}</p>
          </div>
        ))}

        {!lessons?.length && <p className="text-sm text-ink-soft">No homework given yet.</p>}
      </div>
    </div>
  );
}
