import Link from "next/link";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { CreateAssessmentForm } from "@/components/CreateAssessmentForm";
import { redirect } from "next/navigation";

export default async function TeacherGradesPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }
  const supabase = createClient();

  const { data: assessments } = await supabase
    .from("assessments")
    .select("*, classes(name, arm), subjects(name)")
    .eq("created_by", profile.id)
    .order("academic_year", { ascending: false })
    .order("term", { ascending: false });

  const { data: teacherProfile } = await supabase
    .from("teacher_profiles")
    .select("subjects_taught, staff_role")
    .eq("id", profile.id)
    .single();

  const subjectIds = teacherProfile?.subjects_taught ?? [];

  const { data: subjects } = subjectIds.length
    ? await supabase.from("subjects").select("id, name, education_level").in("id", subjectIds)
    : { data: [] };

  const { data: timetableEntries } = await supabase
    .from("timetable_entries")
    .select("subject_id, classes(id, name, arm)")
    .eq("teacher_id", profile.id);

  const classesBySubject = new Map<string, { id: string; name: string; arm: string | null }[]>();
  for (const entry of timetableEntries ?? []) {
    const cls = entry.classes;
    if (!cls) continue;
    const list = classesBySubject.get(entry.subject_id) ?? [];
    if (!list.some((c) => c.id === cls.id)) list.push(cls);
    classesBySubject.set(entry.subject_id, list);
  }

  // HOD moderation: a HOD reviews pending grades school-wide now (see
  // 20260921183938_hod_principal_wide_approval.sql), not just their own
  // subjects_taught -- so this is no longer filtered by subjectIds.
  const { data: moderationAssessments } =
    teacherProfile?.staff_role === "hod"
      ? await supabase.from("assessments").select("id, title, classes(name, arm), subjects(name)")
      : { data: [] };
  const moderationIds = (moderationAssessments ?? []).map((assessment) => assessment.id);
  const { data: moderationGrades } = moderationIds.length
    ? await supabase
        .from("grades")
        .select("assessment_id, moderation_status")
        .in("assessment_id", moderationIds)
    : { data: [] };
  const pendingByAssessment = new Map<string, number>();
  const rejectedByAssessment = new Map<string, number>();
  for (const grade of moderationGrades ?? []) {
    if (grade.moderation_status === "pending")
      pendingByAssessment.set(
        grade.assessment_id,
        (pendingByAssessment.get(grade.assessment_id) ?? 0) + 1
      );
    if (grade.moderation_status === "rejected")
      rejectedByAssessment.set(
        grade.assessment_id,
        (rejectedByAssessment.get(grade.assessment_id) ?? 0) + 1
      );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Grades</h1>
          <p className="text-sm text-ink-soft">
            Assessments you&apos;ve created. Select one to enter or review scores.
          </p>
        </div>
        <CreateAssessmentForm
          subjects={subjects ?? []}
          classesBySubject={Object.fromEntries(classesBySubject)}
        />
      </div>

      <div className="space-y-2">
        {assessments?.map((a) => (
          <Link
            key={a.id}
            href={`/dashboard/teacher/grades/${a.id}`}
            className="flex items-center justify-between rounded-lg border border-rule bg-white px-4 py-3 transition hover:border-leaf"
          >
            <div>
              <p className="text-ink">{a.title}</p>
              <p className="text-xs text-ink-soft">
                {a.subjects?.name} · {a.classes?.name} {a.classes?.arm} · Term {a.term}
              </p>
            </div>
            <span className="text-sm text-ink-soft">Max {a.max_score}</span>
          </Link>
        ))}

        {!assessments?.length && (
          <p className="text-sm text-ink-soft">
            No assessments yet. Create the standard set above to get started.
          </p>
        )}
      </div>

      {teacherProfile?.staff_role === "hod" && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold text-ink">Academic Head moderation</h2>
          <p className="mb-3 text-sm text-ink-soft">
            Review grades before students and parents can see them. Open an assessment to approve or
            reject scores.
          </p>
          <div className="space-y-2">
            {(moderationAssessments ?? []).map((assessment) => {
              const pending = pendingByAssessment.get(assessment.id) ?? 0;
              const rejected = rejectedByAssessment.get(assessment.id) ?? 0;
              return (
                <div
                  key={assessment.id}
                  className="flex items-center justify-between rounded-lg border border-rule bg-white px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-ink">{assessment.title}</p>
                    <p className="text-xs text-ink-soft">
                      {assessment.subjects?.name} · {assessment.classes?.name}{" "}
                      {assessment.classes?.arm}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/teacher/grades/${assessment.id}/review`}
                    className="rounded-lg border border-leaf px-3 py-1.5 text-sm font-medium text-leaf hover:bg-leaf-soft"
                  >
                    {pending
                      ? `Review ${pending} pending`
                      : rejected
                        ? `${rejected} sent back`
                        : "View grades"}
                  </Link>
                </div>
              );
            })}
            {!moderationAssessments?.length && (
              <p className="text-sm text-ink-soft">No assessments for your subjects yet.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
