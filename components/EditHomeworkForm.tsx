"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateHomework } from "@/lib/actions/homework";
import { HomeworkDueDateField } from "@/components/HomeworkDueDateField";
import { emitToast } from "@/lib/toast";

/** Inline "Edit" for homework already given: its text and due date. */
export function EditHomeworkForm({
  lessonId,
  lessonDate,
  homework,
  dueAt,
  submissionCount,
  locked,
}: {
  lessonId: string;
  lessonDate: string;
  homework: string;
  dueAt: string | null;
  submissionCount: number;
  /** Graded homework can't be edited until it's reopened. */
  locked: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(homework);
  const [due, setDue] = useState(dueAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        disabled={locked}
        title={locked ? "Reopen this homework to edit it." : undefined}
        className="text-xs font-medium text-leaf hover:underline disabled:cursor-not-allowed disabled:text-ink-soft disabled:no-underline"
      >
        {locked ? "Edit (reopen first)" : "Edit"}
      </button>
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateHomework(lessonId, {
        homework: text,
        homeworkDueAt: due || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      emitToast("Homework updated.");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-rule bg-paper p-3">
      <textarea
        aria-label="Homework"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-rule bg-white px-3 py-2 text-sm outline-none focus-visible:border-marigold"
      />
      <HomeworkDueDateField
        id={`edit-due-${lessonId}`}
        value={due}
        onChange={setDue}
        min={lessonDate}
      />
      {submissionCount > 0 && (
        <p className="text-xs text-marigold-text">
          {submissionCount} student{submissionCount === 1 ? " has" : "s have"} already submitted
          against the current wording.
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={isPending || !text.trim()}
          className="rounded-lg bg-leaf px-3 py-1.5 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setText(homework);
            setDue(dueAt ?? "");
            setError(null);
          }}
          className="rounded-lg border border-rule px-3 py-1.5 text-sm text-ink-soft"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-clay">{error}</p>}
    </div>
  );
}
