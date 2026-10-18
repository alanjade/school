import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { HomeworkSubmissionUpload } from "@/components/HomeworkSubmissionUpload";
import { homeworkDisplayStatus, homeworkDueStatus } from "@/types/database";
import { HomeworkStatusBadge } from "@/components/HomeworkStatusBadge";
import type { HomeworkStatus, HomeworkSubmissionStatus } from "@/types/database";

type HomeworkLessonRow = {
  id: string;
  lesson_date: string;
  homework: string | null;
  homework_status: HomeworkStatus;
  homework_due_at: string | null;
  curriculum_topics: { title: string } | null;
  timetable_entries: { subjects: { name: string } | null } | null;
  homework_submissions: {
    file_name: string | null;
    status: HomeworkSubmissionStatus;
    teacher_remark: string | null;
  }[];
};

function dueLabel(dueAt: string, status: ReturnType<typeof homeworkDueStatus>): string {
  const formatted = new Date(`${dueAt}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  if (status === "overdue") return `Overdue — was due ${formatted}`;
  if (status === "due_today") return "Due today";
  return `Due ${formatted}`;
}

export default async function StudentHomeworkPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }
  const supabase = createClient();

  const { data: studentProfile } = await supabase
    .from("student_profiles")
    .select("class_id")
    .eq("id", profile.id)
    .single();

  const { data: lessons } = await supabase
    .from("lessons")
    .select(
      "id, lesson_date, homework, homework_status, homework_due_at, curriculum_topics(title), timetable_entries(subjects(name)), homework_submissions(file_name, status, teacher_remark)"
    )
    .eq("class_id", studentProfile?.class_id ?? "")
    .not("homework", "is", null)
    .order("lesson_date", { ascending: false })
    .limit(30)
    .returns<HomeworkLessonRow[]>();

  // Viewing this page is what "seen" means for the nav badge -- clear
  // every reviewed submission's unseen flag in one call. Awaited (not
  // fire-and-forget): some serverless/edge runtimes tear the request down
  // as soon as the response starts streaming, which would silently drop
  // an unawaited call before it ever reached the database.
  await supabase.rpc("mark_all_homework_seen");

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Homework</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Homework given across your subjects, most recent first.
      </p>

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
                // A submitted/reviewed/graded card isn't "overdue" any more.
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
            {l.curriculum_topics?.title && (
              <p className="mb-1 text-xs text-ink-soft">{l.curriculum_topics.title}</p>
            )}
            <p className="text-sm text-ink">{l.homework}</p>
            <HomeworkSubmissionUpload
              lessonId={l.id}
              existing={
                l.homework_submissions?.[0]
                  ? {
                      fileName: l.homework_submissions[0].file_name,
                      status: l.homework_submissions[0].status,
                      remark: l.homework_submissions[0].teacher_remark,
                    }
                  : null
              }
            />
          </div>
        ))}

        {!lessons?.length && <EmptyState message="No homework given yet." />}
      </div>
    </div>
  );
}
