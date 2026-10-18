import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LessonPlanReviewButtons } from "@/components/LessonPlanReviewButtons";
import { Pagination, DEFAULT_PAGE_SIZE, parsePage } from "@/components/Pagination";
import { EmptyState } from "@/components/EmptyState";

export default async function AdminLessonPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = createClient();
  const page = parsePage(resolvedSearchParams.page);

  // Same "latest version per topic" shape as the HOD panel on
  // /dashboard/teacher/notes (see that page's comment) -- an admin can
  // review any subject, per lessonPlanModeration.ts's own eligibility
  // check, but that HOD panel only ever shows the reviewing teacher
  // their own subjects. Admins don't otherwise land on a teacher-facing
  // route, so without this page there was no way for an admin to reach
  // the review action at all -- approveLessonPlan/rejectLessonPlan
  // already worked for them, there was just no UI surfacing it.
  const { data: candidates } = await supabase
    .from("topic_notes")
    .select(
      "id, topic_id, status, moderation_status, version, updated_at, curriculum_topics(title, subjects(name))"
    )
    .order("version", { ascending: false });

  type Candidate = NonNullable<typeof candidates>[number];

  const latestByTopic = new Map<string, Candidate>();
  for (const note of candidates ?? []) {
    if (!latestByTopic.has(note.topic_id)) latestByTopic.set(note.topic_id, note);
  }
  const pending = [...latestByTopic.values()]
    .filter((n) => n.status === "published" && n.moderation_status === "pending")
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  const totalPages = Math.max(1, Math.ceil(pending.length / DEFAULT_PAGE_SIZE));
  const pageStart = (page - 1) * DEFAULT_PAGE_SIZE;
  const pageItems = pending.slice(pageStart, pageStart + DEFAULT_PAGE_SIZE);

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Lesson Plan Review</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Published notes stay hidden from students until an Academic Head (or you) approves them
        here. {pending.length} awaiting review.
      </p>

      {pageItems.length ? (
        <div className="space-y-2">
          {pageItems.map((note) => (
            <div
              key={note.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-white px-4 py-3"
            >
              <div>
                <Link
                  href={`/dashboard/admin/lesson-plans/${note.id}`}
                  className="text-sm font-medium text-ink hover:underline"
                >
                  {note.curriculum_topics?.title ?? "Untitled topic"}
                </Link>
                <p className="text-xs text-ink-soft">
                  {note.curriculum_topics?.subjects?.name ?? "Unknown subject"} · v{note.version} ·{" "}
                  {new Date(note.updated_at).toLocaleString()}
                </p>
              </div>
              <LessonPlanReviewButtons noteId={note.id} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="Nothing waiting on review right now." />
      )}

      <Pagination basePath="/dashboard/admin/lesson-plans" page={page} totalPages={totalPages} />
    </div>
  );
}
