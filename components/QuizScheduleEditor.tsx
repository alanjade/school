"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateQuizSchedule } from "@/lib/actions/quiz";
import { joinDateTime, localIsoDate, quizWindowError, splitDateTime } from "@/lib/quizWindow";
import { TimeSelect } from "@/components/TimeSelect";
import { emitToast } from "@/lib/toast";

/** ISO timestamp -> "YYYY-MM-DDTHH:mm" in the viewer's local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${localIsoDate(d)}T${time}`;
}

function describe(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function QuizScheduleEditor({
  quizId,
  opensAt,
  closesAt,
  isPublished,
}: {
  quizId: string;
  opensAt: string | null;
  closesAt: string | null;
  isPublished: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [opens, setOpens] = useState(toLocalInput(opensAt));
  const [closes, setCloses] = useState(toLocalInput(closesAt));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    const windowError = quizWindowError(opens, closes);
    if (windowError) return setError(windowError);

    startTransition(async () => {
      const result = await updateQuizSchedule(quizId, {
        opensAt: opens ? new Date(opens).toISOString() : undefined,
        closesAt: closes ? new Date(closes).toISOString() : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      emitToast("Quiz schedule updated.");
      setEditing(false);
      router.refresh();
    });
  }

  const dateInput = "min-w-0 flex-1 rounded-lg border border-rule px-3 py-2 text-sm";

  return (
    <div className="mb-6 rounded-xl border border-rule bg-white p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 text-ink-soft">
          <p>
            <span className="font-medium text-ink">Opens:</span>{" "}
            {describe(opensAt, "when published")}
          </p>
          <p>
            <span className="font-medium text-ink">Closes:</span>{" "}
            {describe(closesAt, "no closing time")}
          </p>
        </div>
        {isPublished ? (
          <p className="max-w-[12rem] text-right text-xs text-ink-soft">
            Unpublish to change the schedule.
          </p>
        ) : (
          !editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-rule px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
            >
              Edit schedule
            </button>
          )
        )}
      </div>

      {editing && !isPublished && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-ink-soft">
            Opens at (optional)
            <div className="flex gap-2">
              <input
                type="date"
                aria-label="Opening date"
                min={localIsoDate()}
                value={splitDateTime(opens).date}
                onChange={(e) => setOpens(joinDateTime(e.target.value, splitDateTime(opens).time))}
                className={dateInput}
              />
              <TimeSelect
                value={splitDateTime(opens).time}
                onChangeAction={(time) => setOpens(joinDateTime(splitDateTime(opens).date, time))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 text-ink-soft">
            Closes at (optional)
            <div className="flex gap-2">
              <input
                type="date"
                aria-label="Closing date"
                min={localIsoDate()}
                value={splitDateTime(closes).date}
                onChange={(e) =>
                  setCloses(joinDateTime(e.target.value, splitDateTime(closes).time))
                }
                className={dateInput}
              />
              <TimeSelect
                value={splitDateTime(closes).time}
                onChangeAction={(time) => setCloses(joinDateTime(splitDateTime(closes).date, time))}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button
              onClick={save}
              disabled={isPending}
              className="rounded-lg bg-leaf px-3 py-1.5 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Save schedule"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
                setOpens(toLocalInput(opensAt));
                setCloses(toLocalInput(closesAt));
              }}
              className="rounded-lg border border-rule px-3 py-1.5 text-sm text-ink-soft"
            >
              Cancel
            </button>
            {(opens || closes) && (
              <button
                onClick={() => {
                  setOpens("");
                  setCloses("");
                }}
                className="text-xs text-ink-soft hover:underline"
              >
                Clear both
              </button>
            )}
          </div>
          {error && <p className="text-sm text-clay sm:col-span-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
