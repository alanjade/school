"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BellPeriod } from "@/types/database";
import {
  deleteBellPeriod,
  saveBellPeriod,
  syncEntriesToBellSchedule,
} from "@/lib/actions/bellSchedule";
import { unwrapAction } from "@/lib/actionResult";
import { hhmm, nextPeriodNumber, toMinutes } from "@/lib/bellSchedule";

type FormState = {
  id?: string;
  isBreak: boolean;
  periodNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

const inputClass = "rounded-lg border border-rule px-3 py-2 text-sm";

export function BellScheduleEditor({
  periods,
  mismatchCount,
}: {
  periods: BellPeriod[];
  mismatchCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  const sorted = [...periods].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const lastEnd = sorted.length ? hhmm(sorted[sorted.length - 1].end_time) : "08:00";

  function run(task: () => Promise<void>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await task();
        router.refresh();
      } catch (err: any) {
        setError(err.message ?? "Something went wrong.");
      }
    });
  }

  function openNew(isBreak: boolean) {
    setError(null);
    setNotice(null);
    setForm({
      isBreak,
      periodNumber: nextPeriodNumber(periods),
      label: "",
      // Start where the day currently ends, which is what you want when
      // building a schedule top to bottom.
      startTime: lastEnd,
      endTime: lastEnd,
    });
  }

  function openEdit(p: BellPeriod) {
    setError(null);
    setNotice(null);
    setForm({
      id: p.id,
      isBreak: p.is_break,
      periodNumber: p.period_number ?? nextPeriodNumber(periods),
      label: p.label,
      startTime: hhmm(p.start_time),
      endTime: hhmm(p.end_time),
    });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    run(async () => {
      await unwrapAction(
        saveBellPeriod({
          id: form.id,
          isBreak: form.isBreak,
          periodNumber: form.isBreak ? null : form.periodNumber,
          label: form.label,
          startTime: form.startTime,
          endTime: form.endTime,
        })
      );
      setForm(null);
    });
  }

  function handleDelete(p: BellPeriod) {
    if (!window.confirm(`Remove ${p.label} from the bell schedule?`)) return;
    run(async () => {
      await unwrapAction(deleteBellPeriod(p.id));
      if (form?.id === p.id) setForm(null);
    });
  }

  function handleSync() {
    run(async () => {
      const { updated } = await unwrapAction(syncEntriesToBellSchedule());
      setNotice(`Updated ${updated} lesson${updated === 1 ? "" : "s"} to match the bell schedule.`);
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      {mismatchCount > 0 && (
        <div className="rounded-xl border border-marigold bg-marigold/10 p-4 text-sm text-ink">
          <p>
            {mismatchCount} existing timetable lesson{mismatchCount === 1 ? "" : "s"} ha
            {mismatchCount === 1 ? "s" : "ve"} times that differ from this bell schedule.
          </p>
          <button
            type="button"
            onClick={handleSync}
            disabled={isPending}
            className="mt-2 rounded-lg bg-marigold px-3 py-1.5 text-xs font-medium text-ink hover:bg-marigold-dark disabled:opacity-60"
          >
            {isPending ? "Updating…" : "Update lessons to match"}
          </button>
          <p className="mt-2 text-xs text-ink-soft">
            Only start and end times change, across every class and term. No lesson is added, moved
            or removed.
          </p>
        </div>
      )}

      {notice && <p className="text-sm text-leaf">{notice}</p>}

      <div className="overflow-hidden rounded-xl border border-rule bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule bg-paper text-left text-xs uppercase tracking-wide text-ink-soft">
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.id}
                className={`border-b border-rule last:border-0 ${p.is_break ? "bg-paper/60" : ""}`}
              >
                <td className="px-3 py-2 text-ink-soft">
                  {p.is_break ? "Break" : `P${p.period_number}`}
                </td>
                <td className="px-3 py-2 font-medium text-ink">{p.label}</td>
                <td className="px-3 py-2 text-ink-soft">
                  {hhmm(p.start_time)}–{hhmm(p.end_time)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    disabled={isPending}
                    className="mr-3 text-xs text-leaf hover:underline disabled:opacity-60"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p)}
                    disabled={isPending}
                    className="text-xs text-clay hover:underline disabled:opacity-60"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-ink-soft">
                  No bell schedule yet. Class timetables will keep asking for times lesson by lesson
                  until you add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {form ? (
        <form
          onSubmit={handleSave}
          className="grid grid-cols-2 gap-3 rounded-xl border border-rule bg-white p-4 sm:grid-cols-4"
        >
          <p className="col-span-full text-sm font-medium text-ink">
            {form.id ? "Edit" : "Add"} {form.isBreak ? "break" : "lesson period"}
          </p>

          {!form.isBreak && (
            <label className="text-xs text-ink-soft">
              Period #
              <input
                type="number"
                min={1}
                max={20}
                value={form.periodNumber}
                onChange={(e) => setForm({ ...form, periodNumber: Number(e.target.value) })}
                className={`mt-1 w-full ${inputClass}`}
              />
            </label>
          )}

          <label className={`text-xs text-ink-soft ${form.isBreak ? "col-span-2" : ""}`}>
            Name {form.isBreak ? "" : "(optional)"}
            <input
              value={form.label}
              placeholder={form.isBreak ? "Lunch" : `Period ${form.periodNumber}`}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className={`mt-1 w-full ${inputClass}`}
            />
          </label>

          <label className="text-xs text-ink-soft">
            Starts
            <input
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              className={`mt-1 w-full ${inputClass}`}
            />
          </label>

          <label className="text-xs text-ink-soft">
            Ends
            <input
              type="time"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              className={`mt-1 w-full ${inputClass}`}
            />
          </label>

          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-leaf px-3 py-2 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-lg border border-rule px-3 py-2 text-sm text-ink-soft"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => openNew(false)}
            className="rounded-lg bg-marigold px-4 py-2 text-sm font-medium text-ink hover:bg-marigold-dark"
          >
            + Add period
          </button>
          <button
            type="button"
            onClick={() => openNew(true)}
            className="rounded-lg border border-rule px-4 py-2 text-sm font-medium text-ink-soft hover:bg-paper"
          >
            + Add break
          </button>
        </div>
      )}

      {error && <p className="text-sm text-clay">{error}</p>}
    </div>
  );
}
