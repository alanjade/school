"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { giveHomework } from "@/lib/actions/homework";
import { HomeworkDueDateField } from "@/components/HomeworkDueDateField";
import { localIsoDate } from "@/lib/quizWindow";
import { emitToast } from "@/lib/toast";

const inputClass =
  "w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm outline-none focus-visible:border-marigold";

export function GiveHomeworkForm({
  entries,
}: {
  /** The teacher's timetable slots, e.g. { id, label: "Mathematics — Primary 4 · Mon P2" }. */
  entries: { id: string; label: string }[];
}) {
  const router = useRouter();
  const today = localIsoDate();
  const [open, setOpen] = useState(false);
  const [entryId, setEntryId] = useState(entries[0]?.id ?? "");
  const [lessonDate, setLessonDate] = useState(today);
  const [homework, setHomework] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!entries.length) {
    return (
      <p className="mb-4 rounded-lg border border-dashed border-rule p-3 text-sm text-ink-soft">
        You&apos;re not on the timetable for any class yet, so there&apos;s nothing to give homework
        to. Ask an admin to add you.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 rounded-lg bg-marigold px-4 py-2 text-sm font-medium text-ink hover:bg-marigold-dark"
      >
        + Give homework
      </button>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await giveHomework({
        timetableEntryId: entryId,
        lessonDate,
        homework,
        homeworkDueAt: dueAt || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      emitToast("Homework given.");
      setHomework("");
      setDueAt("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 space-y-4 rounded-xl border border-rule bg-white p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink sm:col-span-2">
          Class and subject
          <select
            value={entryId}
            onChange={(e) => setEntryId(e.target.value)}
            className={`${inputClass} font-normal`}
          >
            {entries.map((en) => (
              <option key={en.id} value={en.id}>
                {en.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">
          Lesson date
          <input
            type="date"
            value={lessonDate}
            max={today}
            required
            onChange={(e) => {
              setLessonDate(e.target.value);
              // Don't leave a due date sitting before the new lesson date.
              if (dueAt && e.target.value && dueAt < e.target.value) setDueAt("");
            }}
            className={`${inputClass} font-normal`}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-ink">
        Homework
        <textarea
          value={homework}
          onChange={(e) => setHomework(e.target.value)}
          rows={3}
          required
          placeholder="What should students do?"
          className={`${inputClass} font-normal`}
        />
      </label>

      <HomeworkDueDateField
        id="give-homework-due"
        value={dueAt}
        onChange={setDueAt}
        min={lessonDate}
      />

      <p className="text-xs text-ink-soft">
        If a lesson was already logged for this class on that date, the homework is added to it.
        Otherwise a lesson is created with just the homework.
      </p>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending || !homework.trim()}
          className="rounded-lg bg-leaf px-3 py-1.5 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
        >
          {isPending ? "Giving…" : "Give homework"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-rule px-3 py-1.5 text-sm text-ink-soft"
        >
          Cancel
        </button>
      </div>

      {error && <p className="text-sm text-clay">{error}</p>}
    </form>
  );
}
