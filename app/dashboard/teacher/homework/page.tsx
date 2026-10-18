import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HOMEWORK_SUBMISSION_BUCKET } from "@/lib/storageBuckets";
import { HomeworkStatusToggle } from "@/components/HomeworkStatusToggle";
import { HomeworkSubmissionReview } from "@/components/HomeworkSubmissionReview";
import { GiveHomeworkForm } from "@/components/GiveHomeworkForm";
import { EditHomeworkForm } from "@/components/EditHomeworkForm";
import { redirect } from "next/navigation";
import { homeworkDueStatus } from "@/types/database";
import type { HomeworkStatus, HomeworkSubmissionStatus } from "@/types/database";

type SubmissionRow = {
  id: string;
  file_url: string;
  file_name: string | null;
  status: HomeworkSubmissionStatus;
  teacher_remark: string | null;
  student_profiles: { profiles: { full_name: string } | null } | null;
};

type HomeworkLessonRow = {
  id: string;
  lesson_date: string;
  homework: string | null;
  homework_status: HomeworkStatus;
  homework_due_at: string | null;
  classes: { name: string; arm: string | null } | null;
  curriculum_topics: { title: string } | null;
  timetable_entries: { subjects: { name: string } | null } | null;
  homework_submissions: SubmissionRow[];
};

function dueLabel(
  dueAt: string,
  status: ReturnType<typeof homeworkDueStatus>,
  submitted: number,
  reviewed: number
): string {
  const formatted = new Date(`${dueAt}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  if (status === "overdue") {
    if (submitted === 0) return `Overdue since ${formatted} — no submissions yet`;
    if (reviewed === 0) {
      return `Overdue since ${formatted} — ${submitted} submitted, none reviewed`;
    }
    return `Past due ${formatted} — ${reviewed} of ${submitted} submission${submitted === 1 ? "" : "s"} reviewed`;
  }
  if (status === "due_today") return "Due today";
  return `Due ${formatted}`;
}

/** Overdue only counts as a problem while nothing has been reviewed yet. */
function isUrgentlyOverdue(lesson: HomeworkLessonRow): boolean {
  if (homeworkDueStatus(lesson) !== "overdue") return false;
  return !lesson.homework_submissions?.some((s) => s.status === "reviewed");
}

function summaryLine(givenCount: number, reviewedCount: number, overdueCount: number): string {
  const parts: string[] = [];
  if (overdueCount > 0) parts.push(`${overdueCount} overdue`);
  if (givenCount === 0 && reviewedCount === 0 && overdueCount === 0) {
    return "All homework has been graded.";
  }
  if (givenCount > 0) parts.push(`${givenCount} not yet reviewed`);
  if (reviewedCount > 0) parts.push(`${reviewedCount} reviewed, awaiting a grade`);
  return parts.join(" · ") + ".";
}

export default async function TeacherHomeworkPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }
  const supabase = createClient();

  const { data: lessons } = await supabase
    .from("lessons")
    .select(
      "id, lesson_date, homework, homework_status, homework_due_at, classes(name, arm), curriculum_topics(title), timetable_entries(subjects(name)), homework_submissions(id, file_url, file_name, status, teacher_remark, student_profiles(profiles(full_name)))"
    )
    .eq("teacher_id", profile.id)
    .not("homework", "is", null)
    .order("lesson_date", { ascending: false })
    .limit(50)
    .returns<HomeworkLessonRow[]>();

  // The teacher's own timetable slots -- what "Give homework" picks from.
  const { data: entryRows } = await supabase
    .from("timetable_entries")
    .select("id, weekday, period_number, classes(name, arm), subjects(name)")
    .eq("teacher_id", profile.id)
    .order("weekday", { ascending: true })
    .order("period_number", { ascending: true });

  const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const entries = (entryRows ?? []).map((e) => ({
    id: e.id,
    label: `${e.subjects?.name ?? "Subject"} — ${`${e.classes?.name ?? ""} ${e.classes?.arm ?? ""}`.trim()} · ${WEEKDAYS[e.weekday] ?? ""} P${e.period_number}`,
  }));

  const givenCount = (lessons ?? []).filter((l) => l.homework_status === "given").length;
  const reviewedCount = (lessons ?? []).filter((l) => l.homework_status === "reviewed").length;
  const overdueCount = (lessons ?? []).filter((l) => isUrgentlyOverdue(l)).length;

  const admin = createAdminClient();
  const signedUrlByPath = new Map<string, string>();
  const allPaths = (lessons ?? []).flatMap(
    (l) => l.homework_submissions?.map((s) => s.file_url) ?? []
  );
  if (allPaths.length) {
    const { data: signed } = await admin.storage
      .from(HOMEWORK_SUBMISSION_BUCKET)
      .createSignedUrls(allPaths, 60 * 60);
    signed?.forEach((s) => {
      if (s.signedUrl && s.path) signedUrlByPath.set(s.path, s.signedUrl);
    });
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Homework given</h1>
      <p className="mb-6 text-sm text-ink-soft">
        {summaryLine(givenCount, reviewedCount, overdueCount)}
      </p>

      <GiveHomeworkForm entries={entries} />

      <div className="space-y-2">
        {lessons?.map((l) => {
          const dueStatus = homeworkDueStatus(l);
          const urgent = isUrgentlyOverdue(l);
          const submittedCount = l.homework_submissions?.length ?? 0;
          const reviewedSubmissions =
            l.homework_submissions?.filter((s) => s.status === "reviewed").length ?? 0;
          return (
            <div
              key={l.id}
              className={`rounded-lg border bg-white p-4 ${
                urgent ? "border-clay/50" : "border-rule"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <p className="font-medium text-ink">
                  {l.timetable_entries?.subjects?.name ?? "Lesson"} — {l.classes?.name}{" "}
                  {l.classes?.arm}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-ink-soft">{l.lesson_date}</span>
                  <HomeworkStatusToggle lessonId={l.id} status={l.homework_status} />
                </div>
              </div>
              {l.homework_due_at && dueStatus !== "none" && (
                <p className={`mb-1 text-xs font-medium ${urgent ? "text-clay" : "text-ink-soft"}`}>
                  {dueLabel(l.homework_due_at, dueStatus, submittedCount, reviewedSubmissions)}
                </p>
              )}
              {l.curriculum_topics?.title && (
                <p className="mb-1 text-xs text-ink-soft">{l.curriculum_topics.title}</p>
              )}
              <p className="whitespace-pre-line text-sm text-ink">{l.homework}</p>
              <div className="mt-1">
                <EditHomeworkForm
                  lessonId={l.id}
                  lessonDate={l.lesson_date}
                  homework={l.homework ?? ""}
                  dueAt={l.homework_due_at}
                  submissionCount={l.homework_submissions?.length ?? 0}
                  locked={l.homework_status === "graded"}
                />
              </div>

              {l.homework_submissions?.length ? (
                <div className="mt-3 rounded-lg border border-rule bg-paper p-2">
                  {l.homework_submissions.map((s) => (
                    <HomeworkSubmissionReview
                      key={s.id}
                      submissionId={s.id}
                      studentName={s.student_profiles?.profiles?.full_name ?? "Student"}
                      fileName={s.file_name}
                      signedUrl={signedUrlByPath.get(s.file_url) ?? null}
                      status={s.status}
                      remark={s.teacher_remark}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink-soft">No submissions yet.</p>
              )}
            </div>
          );
        })}

        {!lessons?.length && (
          <p className="text-sm text-ink-soft">
            No homework yet. Use Give homework above, or add it when logging a lesson.
          </p>
        )}
      </div>
    </div>
  );
}
