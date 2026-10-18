"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAssessmentGrades,
  approveSingleGrade,
  rejectAssessmentGrades,
  rejectSingleGrade,
} from "@/lib/actions/gradesModeration";
import type { ReviewRow } from "@/lib/gradeReview";

const STATUS_STYLE: Record<ReviewRow["status"], string> = {
  pending: "bg-marigold/20 text-marigold-text",
  approved: "bg-leaf-soft text-leaf",
  rejected: "bg-clay/10 text-clay",
};

export function GradeReviewPanel({
  assessmentId,
  maxScore,
  rows,
}: {
  assessmentId: string;
  maxScore: number;
  rows: ReviewRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Which reject box is open: a grade id, or "all" for the bulk one.
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setRejecting(null);
      setReason("");
      router.refresh();
    });
  }

  function rejectBox(onConfirm: () => void) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for the teacher (required)"
          className="min-w-[220px] flex-1 rounded-md border border-rule px-2 py-1 text-sm outline-none focus-visible:border-marigold"
        />
        <button
          onClick={onConfirm}
          disabled={isPending || !reason.trim()}
          className="rounded-md bg-clay px-3 py-1 text-xs font-medium text-white hover:bg-clay/90 disabled:opacity-60"
        >
          {isPending ? "Rejecting…" : "Confirm reject"}
        </button>
        <button
          onClick={() => {
            setRejecting(null);
            setReason("");
          }}
          className="text-xs text-ink-soft hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      {pendingCount > 0 && (
        <div className="mb-4 rounded-lg border border-rule bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink">
              {pendingCount} grade{pendingCount === 1 ? "" : "s"} awaiting review
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => run(() => approveAssessmentGrades(assessmentId))}
                disabled={isPending}
                className="rounded-lg bg-leaf px-3 py-1.5 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
              >
                {isPending && rejecting === null ? "Approving…" : "Approve all pending"}
              </button>
              <button
                onClick={() => {
                  setRejecting(rejecting === "all" ? null : "all");
                  setReason("");
                }}
                disabled={isPending}
                className="rounded-lg border border-clay px-3 py-1.5 text-sm font-medium text-clay hover:bg-clay/10 disabled:opacity-60"
              >
                Reject all pending
              </button>
            </div>
          </div>
          {rejecting === "all" &&
            rejectBox(() => run(() => rejectAssessmentGrades(assessmentId, reason)))}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-clay">{error}</p>}

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.gradeId} className="rounded-lg border border-rule bg-white px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-ink">{row.studentName}</p>
                <p className="text-xs text-ink-soft">
                  {row.admissionNo ? `${row.admissionNo} · ` : ""}
                  {row.score} / {maxScore}
                  {row.remark ? ` · ${row.remark}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[row.status]}`}
                >
                  {row.status}
                </span>
                {row.status !== "approved" && (
                  <button
                    onClick={() => run(() => approveSingleGrade(row.gradeId))}
                    disabled={isPending}
                    className="rounded-md border border-leaf px-2.5 py-1 text-xs font-medium text-leaf hover:bg-leaf-soft disabled:opacity-60"
                  >
                    Approve
                  </button>
                )}
                {row.status !== "rejected" && (
                  <button
                    onClick={() => {
                      setRejecting(rejecting === row.gradeId ? null : row.gradeId);
                      setReason("");
                    }}
                    disabled={isPending}
                    className="rounded-md border border-clay px-2.5 py-1 text-xs font-medium text-clay hover:bg-clay/10 disabled:opacity-60"
                  >
                    Reject
                  </button>
                )}
              </div>
            </div>
            {row.status === "rejected" && row.reviewNote && (
              <p className="mt-1 text-xs text-clay">Sent back: {row.reviewNote}</p>
            )}
            {rejecting === row.gradeId &&
              rejectBox(() => run(() => rejectSingleGrade(row.gradeId, reason)))}
          </div>
        ))}
      </div>
    </div>
  );
}
