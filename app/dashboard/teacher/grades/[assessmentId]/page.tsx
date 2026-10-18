import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GradeEntryForm } from "@/components/GradeEntryForm";
import { GradeCsvImport } from "@/components/GradeCsvImport";
import { EmptyState } from "@/components/EmptyState";

export default async function GradeEntryPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const resolvedParams = await params;

  const supabase = createClient();

  const { data: assessment } = await supabase
    .from("assessments")
    .select("*, classes(id, name, arm)")
    .eq("id", resolvedParams.assessmentId)
    .single();

  const classId = assessment?.classes?.id;

  const { data: roster } = await supabase
    .from("student_profiles")
    .select("id, profiles(full_name)")
    .eq("class_id", classId ?? "");

  const students = (roster ?? [])
    .map((r: any) => ({ id: r.id, full_name: r.profiles?.full_name ?? "Unknown" }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const { data: existingGrades } = await supabase
    .from("grades")
    .select("student_id, score, remark, moderation_status, review_note")
    .eq("assessment_id", resolvedParams.assessmentId);

  const nameById = new Map(students.map((st) => [st.id, st.full_name]));
  const sentBack = (existingGrades ?? [])
    .filter((g) => g.moderation_status === "rejected")
    .map((g) => ({
      name: nameById.get(g.student_id) ?? "Unknown student",
      score: g.score,
      note: g.review_note,
    }));

  const initialGrades: Record<string, { score: number; remark: string | null }> = {};
  for (const g of existingGrades ?? []) {
    initialGrades[g.student_id] = { score: g.score, remark: g.remark };
  }

  return (
    <div className="max-w-xl">
      <Link
        href="/dashboard/teacher/grades"
        className="mb-2 inline-block text-sm text-leaf hover:underline"
      >
        ← Grades
      </Link>
      <p className="mb-1 text-xs uppercase tracking-wide text-leaf">
        {assessment?.classes?.name} {assessment?.classes?.arm}
      </p>
      <h1 className="mb-6 font-display text-2xl font-semibold text-ink">
        {assessment?.title}{" "}
        <span className="text-base font-normal text-ink-soft">/ {assessment?.max_score}</span>
      </h1>

      {sentBack.length > 0 && (
        <div className="mb-6 rounded-lg border border-clay/40 bg-clay/5 p-4">
          <p className="mb-2 text-sm font-medium text-clay">
            An Academic Head sent {sentBack.length} grade{sentBack.length === 1 ? "" : "s"} back.
            Edit and save to resubmit.
          </p>
          <ul className="space-y-1 text-sm text-ink">
            {sentBack.map((g) => (
              <li key={g.name}>
                {g.name} ({g.score}){g.note ? ` — ${g.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {students.length ? (
        <>
          <GradeCsvImport assessmentId={resolvedParams.assessmentId} />
          <GradeEntryForm
            assessmentId={resolvedParams.assessmentId}
            maxScore={assessment?.max_score ?? 100}
            students={students}
            initialGrades={initialGrades}
          />
        </>
      ) : (
        <EmptyState message="No students found in this class." />
      )}
    </div>
  );
}
