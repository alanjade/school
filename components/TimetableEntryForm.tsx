"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { timetableEntrySchema, fieldErrorsFrom } from "@/lib/validation";
import { levelLabel } from "@/lib/educationLevel";

const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];

export function TimetableEntryForm({
  classId,
  academicYear,
  term,
  subjects,
  teachers,
  bellPeriods = [],
}: {
  classId: string;
  academicYear: string;
  term: number;
  subjects: { id: string; name: string; education_level?: string | null }[];
  teachers: { id: string; full_name: string }[];
  /**
   * Lesson periods from the school bell schedule ("HH:MM" times). When
   * present the period is picked from this list and its times come from
   * the bell schedule; when empty the admin types the times as before.
   */
  bellPeriods?: { periodNumber: number; label: string; startTime: string; endTime: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [weekday, setWeekday] = useState(1);
  const [periodNumber, setPeriodNumber] = useState(bellPeriods[0]?.periodNumber ?? 1);
  const [manualStart, setManualStart] = useState("08:00");
  const [manualEnd, setManualEnd] = useState("08:40");
  const selectedBell = bellPeriods.find((p) => p.periodNumber === periodNumber);
  const usingBellSchedule = bellPeriods.length > 0;
  const startTime = selectedBell?.startTime ?? manualStart;
  const endTime = selectedBell?.endTime ?? manualEnd;
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const [room, setRoom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const input = {
      weekday,
      periodNumber,
      startTime,
      endTime,
      subjectId,
      teacherId,
      room: room.trim() || undefined,
    };
    const errors = fieldErrorsFrom(timetableEntrySchema, input);
    if (errors) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);

    // --- Conflict checks, run before inserting ---

    // 1. Is this class already booked for this weekday + period?
    const { data: classClash } = await supabase
      .from("timetable_entries")
      .select("id")
      .eq("class_id", classId)
      .eq("weekday", weekday)
      .eq("period_number", periodNumber)
      .eq("academic_year", academicYear)
      .eq("term", term)
      .maybeSingle();

    if (classClash) {
      setSaving(false);
      setError(
        "This class already has a lesson in that period. Remove it first or pick a different period."
      );
      return;
    }

    // 2. Is the selected teacher already teaching a different class at the
    //    same weekday + period? (the actual double-booking case)
    const { data: teacherClash } = await supabase
      .from("timetable_entries")
      .select("id, class_id, classes(name, arm)")
      .eq("teacher_id", teacherId)
      .eq("weekday", weekday)
      .eq("period_number", periodNumber)
      .eq("academic_year", academicYear)
      .eq("term", term)
      .maybeSingle();

    if (teacherClash) {
      const clashClass = teacherClash.classes;
      setSaving(false);
      setError(
        `This teacher is already scheduled for ${clashClass?.name ?? "another class"} ${
          clashClass?.arm ?? ""
        } at that time.`
      );
      return;
    }

    // 3. If a room was specified, is it already in use at that time?
    if (room.trim()) {
      const { data: roomClash } = await supabase
        .from("timetable_entries")
        .select("id")
        .eq("room", room.trim())
        .eq("weekday", weekday)
        .eq("period_number", periodNumber)
        .eq("academic_year", academicYear)
        .eq("term", term)
        .maybeSingle();

      if (roomClash) {
        setSaving(false);
        setError(`Room "${room}" is already booked for that period.`);
        return;
      }
    }

    const { error: insertError } = await supabase.from("timetable_entries").insert({
      class_id: classId,
      subject_id: subjectId,
      teacher_id: teacherId,
      weekday,
      period_number: periodNumber,
      start_time: startTime,
      end_time: endTime,
      room: room.trim() || null,
      academic_year: academicYear,
      term,
    });

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-marigold px-4 py-2 text-sm font-medium text-ink hover:bg-marigold-dark"
      >
        + Add period
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-rule bg-white p-4 sm:grid-cols-4"
    >
      <select
        value={weekday}
        onChange={(e) => setWeekday(Number(e.target.value))}
        className="rounded-lg border border-rule px-3 py-2 text-sm"
      >
        {WEEKDAYS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>

      {usingBellSchedule ? (
        <select
          value={periodNumber}
          onChange={(e) => setPeriodNumber(Number(e.target.value))}
          className="col-span-2 rounded-lg border border-rule px-3 py-2 text-sm sm:col-span-3"
        >
          {bellPeriods.map((p) => (
            <option key={p.periodNumber} value={p.periodNumber}>
              P{p.periodNumber} · {p.label} ({p.startTime}–{p.endTime})
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            type="number"
            min={1}
            max={10}
            placeholder="Period #"
            value={periodNumber}
            onChange={(e) => setPeriodNumber(Number(e.target.value))}
            className="rounded-lg border border-rule px-3 py-2 text-sm"
          />

          <input
            type="time"
            value={manualStart}
            onChange={(e) => setManualStart(e.target.value)}
            className="rounded-lg border border-rule px-3 py-2 text-sm"
          />
          <div className="col-span-1">
            <input
              type="time"
              value={manualEnd}
              onChange={(e) => setManualEnd(e.target.value)}
              className="w-full rounded-lg border border-rule px-3 py-2 text-sm"
            />
            {fieldErrors.endTime && <p className="mt-1 text-xs text-clay">{fieldErrors.endTime}</p>}
          </div>
        </>
      )}

      <select
        value={subjectId}
        onChange={(e) => setSubjectId(e.target.value)}
        className="col-span-2 rounded-lg border border-rule px-3 py-2 text-sm"
      >
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.education_level ? ` (${levelLabel(s.education_level)})` : ""}
          </option>
        ))}
      </select>

      <select
        value={teacherId}
        onChange={(e) => setTeacherId(e.target.value)}
        className="col-span-2 rounded-lg border border-rule px-3 py-2 text-sm"
      >
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.full_name}
          </option>
        ))}
      </select>

      <input
        placeholder="Room (optional)"
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        className="rounded-lg border border-rule px-3 py-2 text-sm"
      />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !subjects.length || !teachers.length}
          className="rounded-lg bg-leaf px-3 py-2 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
        >
          {saving ? "Checking…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-rule px-3 py-2 text-sm text-ink-soft"
        >
          Cancel
        </button>
      </div>

      {error && <p className="col-span-full text-sm text-clay">{error}</p>}
      {(!subjects.length || !teachers.length) && (
        <p className="col-span-full text-sm text-ink-soft">
          Add subjects and teachers before building a timetable.
        </p>
      )}
    </form>
  );
}
