import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LessonPlanReviewButtons } from "@/components/LessonPlanReviewButtons";
import { Pagination, DEFAULT_PAGE_SIZE, parsePage } from "@/components/Pagination";
import { EmptyState } from "@/components/EmptyState";

type StatusFilter = "pending" | "approved" | "rejected";

const TABS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Awaiting review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function parseStatus(raw: string | undefined): StatusFilter {
  return raw === "approved" || raw === "rejected" ? raw : "pending";
}

export default async function HodLessonPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; subject?: string }>;
}) {
  const sp = await searchParams;
  const supabase = createClient();
  const page = parsePage(sp.page);
  const status = parseStatus(sp.status);
  const subjectFilter = sp.subject ?? "";

  // Any active HOD can see and act on every subject (see
  // 20260921184114_hod_principal_wide_approval.sql), so this is the full
  // school-wide queue, not just the HOD's own subjects_taught.
  const { data: candidates } = await supabase
    .from("topic_notes")
    .select(
      "id, topic_id, status, moderation_status, version, updated_at, profiles(full_name), curriculum_topics(title, subject_id, subjects(name))"
    )
    .order("version", { ascending: false });

  type Candidate = NonNullable<typeof candidates>[number];

  // Highest version per topic is the only one worth acting on; older
  // versions are superseded and keep whatever status they were left with.
  const latestByTopic = new Map<string, Candidate>();
  for (const note of candidates ?? []) {
    if (!latestByTopic.has(note.topic_id)) latestByTopic.set(note.topic_id, note);
  }
  const published = [...latestByTopic.values()].filter((n) => n.status === "published");

  const counts: Record<StatusFilter, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const n of published) {
    const key = n.moderation_status as StatusFilter;
    if (key in counts) counts[key] += 1;
  }

  const subjects = new Map<string, string>();
  for (const n of published) {
    const id = n.curriculum_topics?.subject_id;
    const name = n.curriculum_topics?.subjects?.name;
    if (id && name) subjects.set(id, name);
  }
  const subjectOptions = [...subjects.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const filtered = published
    .filter((n) => n.moderation_status === status)
    .filter((n) => !subjectFilter || n.curriculum_topics?.subject_id === subjectFilter)
    // Oldest first for the review queue so nothing sits waiting; newest
    // first for the already-decided history.
    .sort((a, b) =>
      status === "pending"
        ? a.updated_at < b.updated_at
          ? -1
          : 1
        : a.updated_at < b.updated_at
          ? 1
          : -1
    );

  const totalPages = Math.max(1, Math.ceil(filtered.length / DEFAULT_PAGE_SIZE));
  const pageStart = (page - 1) * DEFAULT_PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + DEFAULT_PAGE_SIZE);

  function tabHref(key: StatusFilter) {
    const params = new URLSearchParams({ status: key });
    if (subjectFilter) params.set("subject", subjectFilter);
    return `/dashboard/teacher/lesson-plans?${params.toString()}`;
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Lesson plan review</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Published notes stay hidden from students until an Academic Head approves them.{" "}
        {counts.pending} awaiting review across all subjects.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-paper p-1">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={tabHref(tab.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                status === tab.key ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs text-ink-soft">{counts[tab.key]}</span>
            </Link>
          ))}
        </div>

        {subjectOptions.length > 1 && (
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="status" value={status} />
            <label htmlFor="subject" className="text-xs text-ink-soft">
              Subject
            </label>
            <select
              id="subject"
              name="subject"
              defaultValue={subjectFilter}
              className="rounded-md border border-rule bg-white px-2 py-1.5 text-sm outline-none focus-visible:border-marigold"
            >
              <option value="">All subjects</option>
              {subjectOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
            >
              Filter
            </button>
          </form>
        )}
      </div>

      {pageItems.length ? (
        <div className="space-y-2">
          {pageItems.map((note) => (
            <div
              key={note.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-white px-4 py-3"
            >
              <div>
                <Link
                  href={`/dashboard/teacher/lesson-plans/${note.id}`}
                  className="text-sm font-medium text-ink hover:underline"
                >
                  {note.curriculum_topics?.title ?? "Untitled topic"}
                </Link>
                <p className="text-xs text-ink-soft">
                  {note.curriculum_topics?.subjects?.name ?? "Unknown subject"} · v{note.version}
                  {note.profiles?.full_name ? ` · by ${note.profiles.full_name}` : ""} ·{" "}
                  {new Date(note.updated_at).toLocaleString()}
                </p>
              </div>
              {status === "pending" ? (
                <LessonPlanReviewButtons noteId={note.id} />
              ) : (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    status === "approved" ? "bg-leaf-soft text-leaf" : "bg-clay/10 text-clay"
                  }`}
                >
                  {status === "approved" ? "Approved" : "Rejected"}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          message={
            status === "pending"
              ? "Nothing waiting on review right now."
              : `No ${status} lesson plans${subjectFilter ? " for this subject" : ""}.`
          }
        />
      )}

      <Pagination
        basePath="/dashboard/teacher/lesson-plans"
        page={page}
        totalPages={totalPages}
        searchParams={{ status, ...(subjectFilter ? { subject: subjectFilter } : {}) }}
      />
    </div>
  );
}
