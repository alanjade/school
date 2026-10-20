"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  startQuizAttempt,
  getQuizAttemptQuestions,
  answerQuizQuestion,
  submitQuizAttempt,
} from "@/lib/actions/quizAttempt";
import { getQuizPreviewQuestions } from "@/lib/actions/quiz";
import { emitToast } from "@/lib/toast";
import { QuestionText } from "@/components/QuestionText";
import { unwrapAction } from "@/lib/actionResult";
import { groupQuestions, type QuizRunnerQuestion as Question } from "@/lib/quizAttemptRows";

// Local scoring key used only in preview mode, built once at load from
// quiz_options.is_correct (which the real student-facing RPCs never
// expose — grading there happens server-side in submit_quiz_attempt so
// a student can't read answers out of the network tab). Mirrors that
// same SQL's per-type logic exactly (case-insensitive/trimmed compares,
// matching all-or-nothing) so a teacher's practice score matches what a
// student would actually get.
type AnswerKeyEntry =
  | { type: "options"; correctOptionId: string }
  | { type: "fill_blank"; accepted: string[] }
  | { type: "matching"; correctPairs: Record<string, string> }
  | { type: "essay" };

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Thresholds (seconds) at which a one-time "time's running out" toast
// fires. Checked in descending order against secondsLeft each tick so a
// slow tab (background throttling, etc.) that skips past one threshold
// straight to a lower one still fires the lower one instead of being
// silently skipped.
const WARNING_THRESHOLDS_SECONDS = [5 * 60, 60];

export function QuizAttemptRunner({
  quizId,
  quizTitle,
  durationMinutes,
  closesAt,
  mode = "attempt",
}: {
  quizId: string;
  quizTitle: string;
  durationMinutes: number;
  // Absolute deadline for the quiz as a whole (from quizzes.closes_at),
  // distinct from durationMinutes which is the per-attempt time budget.
  // A student who starts late still has to submit by this wall-clock
  // time even if their per-attempt duration hasn't run out yet.
  closesAt?: string | null;
  // "preview": a teacher/admin dry-run. No quiz_attempts row is ever
  // created, no quiz_answers are persisted, no grade is recorded — the
  // whole thing lives in this component's state and is scored locally
  // on submit. closesAt is ignored in this mode (there's no real
  // attempt for a deadline to apply to).
  mode?: "attempt" | "preview";
}) {
  const router = useRouter();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [matchedAnswers, setMatchedAnswers] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; total_points: number } | null>(null);
  const hasSubmitted = useRef(false);
  // Preview-mode-only scoring key, keyed by question id. Populated once
  // when preview questions load; unused (stays empty) in normal attempt
  // mode since real scoring happens server-side.
  const answerKeyRef = useRef<Record<string, AnswerKeyEntry>>({});
  // Tracks which warning thresholds have already fired this attempt, so
  // the 400ms-granular countdown tick doesn't re-toast every second
  // once secondsLeft is below a threshold.
  const firedWarnings = useRef<Set<number>>(new Set());
  // fill_blank/essay/matching answers used to call answerQuizQuestion on
  // every keystroke -- fast typing fired a parallel RPC per character,
  // and with no ordering guarantee the last response to land (not the
  // last one sent) could overwrite a newer keystroke. Debounce those
  // saves per-question; MCQ/true_false stay immediate since a click is a
  // single discrete event, not a stream.
  const saveTimers = useRef<
    Record<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> }>
  >({});

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      Object.values(timers).forEach(({ timer }) => clearTimeout(timer));
    };
  }, []);

  function debouncedSave(questionId: string, save: () => Promise<void>) {
    const timers = saveTimers.current;
    if (timers[questionId]) clearTimeout(timers[questionId].timer);
    const timer = setTimeout(() => {
      delete timers[questionId];
      save();
    }, 400);
    timers[questionId] = { timer, run: save };
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (mode === "preview") {
          // No attempt row, no closes_at capping (there's no real
          // attempt for a deadline to bind to) — just a plain
          // duration_minutes countdown for a realistic feel.
          setSecondsLeft(durationMinutes * 60);
          const rows = await unwrapAction(getQuizPreviewQuestions(quizId));
          if (cancelled) return;
          const qs: Question[] = [];
          const key: Record<string, AnswerKeyEntry> = {};
          for (const row of rows) {
            const opts = [...(row.quiz_options ?? [])].sort(
              (a, b) => a.sequence_order - b.sequence_order
            );
            qs.push({
              id: row.id,
              text: row.question_text,
              points: row.points,
              type: row.question_type,
              options: opts.map((o) => ({
                id: o.id,
                text: o.option_text ?? "",
                matchPrompt: o.match_prompt,
              })),
              // Same shape as a student's attempt: the dropdown is built
              // from the right-hand terms alone. Preview reads the staff-
              // only tables directly, so it still has the full options.
              pool: row.question_type === "matching" ? opts.map((o) => o.option_text ?? "") : [],
            });
            if (row.question_type === "mcq" || row.question_type === "true_false") {
              key[row.id] = {
                type: "options",
                correctOptionId: opts.find((o) => o.is_correct)?.id ?? "",
              };
            } else if (row.question_type === "fill_blank") {
              key[row.id] = {
                type: "fill_blank",
                accepted: opts
                  .filter((o) => o.is_correct)
                  .map((o) => (o.option_text ?? "").trim().toLowerCase()),
              };
            } else if (row.question_type === "matching") {
              const correctPairs: Record<string, string> = {};
              for (const o of opts) correctPairs[o.id] = (o.option_text ?? "").trim().toLowerCase();
              key[row.id] = { type: "matching", correctPairs };
            } else {
              key[row.id] = { type: "essay" };
            }
          }
          answerKeyRef.current = key;
          setQuestions(qs);
          setLoading(false);
          return;
        }

        const attempt = await unwrapAction(startQuizAttempt(quizId));
        if (cancelled) return;
        setAttemptId(attempt.id);

        const elapsedSeconds = Math.floor(
          (Date.now() - new Date(attempt.started_at).getTime()) / 1000
        );
        const durationRemaining = durationMinutes * 60 - elapsedSeconds;
        // The effective deadline is whichever comes first: the
        // per-attempt duration running out, or the quiz's own closes_at
        // passing (e.g. a 30-minute quiz that closes for everyone at
        // 3pm, started by a student at 2:50pm only really gets 10
        // minutes, not 30).
        const closesAtRemaining = closesAt
          ? Math.floor((new Date(closesAt).getTime() - Date.now()) / 1000)
          : Infinity;
        const remaining = Math.max(0, Math.min(durationRemaining, closesAtRemaining));
        setSecondsLeft(remaining);
        // Any threshold the attempt is already past by the time it loads
        // (e.g. resuming a page reload with 40s left) shouldn't toast —
        // only crossings that happen live, in the ticking effect below.
        for (const t of WARNING_THRESHOLDS_SECONDS) {
          if (remaining <= t) firedWarnings.current.add(t);
        }

        const rows = await unwrapAction(getQuizAttemptQuestions(attempt.id));
        if (cancelled) return;
        const { questions: qs, selected, text, matched } = groupQuestions(rows);
        setQuestions(qs);
        setSelectedAnswers(selected);
        setTextAnswers(text);
        setMatchedAnswers(matched);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId, durationMinutes, mode, closesAt]);

  const doSubmit = useCallback(async () => {
    if (hasSubmitted.current) return;
    if (mode !== "preview" && !attemptId) return;
    hasSubmitted.current = true;
    setSubmitting(true);

    if (mode === "preview") {
      // Scored entirely client-side, mirroring submit_quiz_attempt's SQL
      // per-type logic (see answerKeyRef comment) — nothing is written
      // anywhere, so there's no server round trip to await here.
      let score = 0;
      for (const q of questions) {
        const entry = answerKeyRef.current[q.id];
        if (!entry) continue;
        if (entry.type === "options") {
          if (selectedAnswers[q.id] === entry.correctOptionId) score += q.points;
        } else if (entry.type === "fill_blank") {
          const answer = (textAnswers[q.id] ?? "").trim().toLowerCase();
          if (answer && entry.accepted.includes(answer)) score += q.points;
        } else if (entry.type === "matching") {
          const pairs = matchedAnswers[q.id] ?? {};
          const pairIds = Object.keys(entry.correctPairs);
          const allCorrect = pairIds.every(
            (optId) => (pairs[optId] ?? "").trim().toLowerCase() === entry.correctPairs[optId]
          );
          if (pairIds.length > 0 && allCorrect) score += q.points;
        }
        // essay: never auto-scored, same as the real submit flow.
      }
      const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
      setResult({ score, total_points: totalPoints });
      setSubmitting(false);
      return;
    }

    // Flush any answers still waiting out their debounce window so a
    // keystroke from the last 400ms isn't dropped by the submit.
    const timers = saveTimers.current;
    const pendingSaves = Object.keys(timers).map((questionId) => {
      const pending = timers[questionId];
      clearTimeout(pending.timer);
      delete timers[questionId];
      return pending.run();
    });
    await Promise.all(pendingSaves);
    try {
      const res = await unwrapAction(submitQuizAttempt(attemptId!));
      setResult(res);
    } catch (err) {
      emitToast(err instanceof Error ? err.message : "Something went wrong.", "error");
      hasSubmitted.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, mode, questions, selectedAnswers, textAnswers, matchedAnswers]);

  useEffect(() => {
    if (secondsLeft === null || result) return;
    if (secondsLeft <= 0) {
      doSubmit();
      return;
    }
    for (const t of WARNING_THRESHOLDS_SECONDS) {
      if (secondsLeft <= t && !firedWarnings.current.has(t)) {
        firedWarnings.current.add(t);
        emitToast(
          `${formatClock(secondsLeft)} left — your quiz will auto-submit when time runs out.`,
          "info"
        );
      }
    }
    const timer = setTimeout(() => setSecondsLeft((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, result, doSubmit]);

  function selectOption(questionId: string, optionId: string) {
    setSelectedAnswers((a) => ({ ...a, [questionId]: optionId }));
    if (attemptId) {
      unwrapAction(answerQuizQuestion(attemptId, questionId, { selectedOptionId: optionId })).catch(
        (err) => {
          emitToast(err instanceof Error ? err.message : "Couldn't save that answer.", "error");
        }
      );
    }
  }

  function setTextAnswer(questionId: string, value: string) {
    setTextAnswers((a) => ({ ...a, [questionId]: value }));
    if (attemptId) {
      debouncedSave(questionId, () =>
        unwrapAction(answerQuizQuestion(attemptId, questionId, { answerText: value })).catch(
          (err) => {
            emitToast(err instanceof Error ? err.message : "Couldn't save that answer.", "error");
          }
        )
      );
    }
  }

  function setMatchAnswer(questionId: string, optionId: string, chosenText: string) {
    setMatchedAnswers((a) => {
      const next = { ...a, [questionId]: { ...(a[questionId] ?? {}), [optionId]: chosenText } };
      if (attemptId) {
        const pairs = next[questionId];
        debouncedSave(questionId, () =>
          unwrapAction(answerQuizQuestion(attemptId, questionId, { matchedPairs: pairs })).catch(
            (err) => {
              emitToast(err instanceof Error ? err.message : "Couldn't save that answer.", "error");
            }
          )
        );
      }
      return next;
    });
  }

  if (loading) return <p className="text-sm text-ink-soft">Loading quiz…</p>;
  if (loadError) return <p className="text-sm text-clay">{loadError}</p>;

  if (result) {
    const hasEssay = questions.some((q) => q.type === "essay");
    return (
      <div className="max-w-lg rounded-xl border border-rule bg-white p-6 text-center">
        <p className="mb-1 font-display text-xl font-semibold text-ink">
          {mode === "preview" ? "Preview complete" : "Submitted"}
        </p>
        <p className="mb-4 text-sm text-ink-soft">
          {mode === "preview" ? (
            <>
              {result.score}/{result.total_points}
              {hasEssay && " (essay questions excluded — they're never auto-scored)"} — this was a
              preview, nothing was saved.
            </>
          ) : hasEssay ? (
            // Essay questions score 0 at submit time (submit_quiz_attempt
            // never auto-grades them) -- showing the raw result.score/
            // total_points here would understate the real total and read
            // as final when it isn't. The actual updated score is visible
            // on the quizzes list once a teacher grades the essay
            // question(s) and it clears moderation.
            <>
              This quiz includes essay questions, which your teacher grades separately. Your final
              score will appear on the quizzes list once that&apos;s done and your teacher approves
              it.
            </>
          ) : (
            <>
              {result.score}/{result.total_points} — your score is pending your teacher&apos;s
              approval.
            </>
          )}
        </p>
        <button
          onClick={() =>
            router.push(
              mode === "preview"
                ? `/dashboard/teacher/quizzes/${quizId}`
                : "/dashboard/student/quizzes"
            )
          }
          className="rounded-lg bg-leaf px-4 py-2 text-sm font-medium text-white hover:bg-leaf/90"
        >
          {mode === "preview" ? "Back to quiz" : "Back to quizzes"}
        </button>
      </div>
    );
  }

  function isAnswered(q: Question) {
    if (q.type === "matching") {
      return q.options.every((o) => (matchedAnswers[q.id]?.[o.id] ?? "").trim());
    }
    if (q.type === "fill_blank" || q.type === "essay") {
      return (textAnswers[q.id] ?? "").trim().length > 0;
    }
    return Boolean(selectedAnswers[q.id]);
  }

  const answeredCount = questions.filter(isAnswered).length;

  return (
    <div className="max-w-2xl">
      {mode === "preview" && (
        <div className="mb-4 rounded-xl border border-marigold bg-marigold-soft px-3 py-2 text-sm text-ink">
          <span className="font-medium">Preview mode</span> — you&apos;re dry-running this quiz as a
          teacher. Nothing you do here is saved or scored for any student.
        </div>
      )}
      <div className="sticky top-0 z-10 mb-4 flex items-center justify-between rounded-xl border border-rule bg-white/95 p-3 backdrop-blur">
        <div>
          <p className="text-sm font-medium text-ink">{quizTitle}</p>
          <p className="text-xs text-ink-soft">
            {answeredCount}/{questions.length} answered
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            secondsLeft !== null && secondsLeft < 60
              ? "bg-clay/10 text-clay"
              : "bg-marigold-soft text-ink"
          }`}
        >
          {secondsLeft !== null ? formatClock(secondsLeft) : "--:--"}
        </span>
      </div>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-xl border border-rule bg-white p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                Question {i + 1}
              </span>
              <span className="text-xs text-ink-soft">{q.points} pts</span>
            </div>
            <QuestionText text={q.text} className="mb-3" />

            {(q.type === "mcq" || q.type === "true_false") && (
              <div className="space-y-2">
                {q.options.map((o) => (
                  <label
                    key={o.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      selectedAnswers[q.id] === o.id
                        ? "border-leaf bg-leaf-soft"
                        : "border-rule hover:bg-paper"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      checked={selectedAnswers[q.id] === o.id}
                      onChange={() => selectOption(q.id, o.id)}
                    />
                    <QuestionText text={o.text} className="inline" />
                  </label>
                ))}
              </div>
            )}

            {q.type === "fill_blank" && (
              <input
                value={textAnswers[q.id] ?? ""}
                onChange={(e) => setTextAnswer(q.id, e.target.value)}
                placeholder="Your answer"
                className="w-full rounded-lg border border-rule px-3 py-2 text-sm outline-none focus-visible:border-marigold"
              />
            )}

            {q.type === "essay" && (
              <textarea
                value={textAnswers[q.id] ?? ""}
                onChange={(e) => setTextAnswer(q.id, e.target.value)}
                placeholder="Write your answer…"
                rows={5}
                className="w-full rounded-lg border border-rule px-3 py-2 text-sm outline-none focus-visible:border-marigold"
              />
            )}

            {q.type === "matching" && (
              <div className="space-y-2">
                {q.options.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 text-sm">
                    <div className="flex-1 rounded-lg border border-rule bg-paper px-3 py-2">
                      {/* Native <select><option> renders text only, no
                          HTML/KaTeX -- that's a browser limitation, not
                          fixable client-side, so the match/answer list
                          below stays plain text. The prompt side has no
                          such constraint and now renders properly instead
                          of showing raw "$...$" markup. */}
                      <QuestionText text={o.matchPrompt ?? ""} className="inline" />
                    </div>
                    <span className="text-ink-soft">→</span>
                    <select
                      value={matchedAnswers[q.id]?.[o.id] ?? ""}
                      onChange={(e) => setMatchAnswer(q.id, o.id, e.target.value)}
                      className="flex-1 rounded-lg border border-rule px-3 py-2"
                    >
                      <option value="" disabled>
                        Choose a match…
                      </option>
                      {[...q.pool]
                        .sort((a, b) => a.localeCompare(b))
                        .map((text, i) => (
                          <option key={`${i}-${text}`} value={text}>
                            {text}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={doSubmit}
        disabled={submitting}
        className="mt-6 rounded-lg bg-leaf px-4 py-2 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
      >
        {submitting ? "Submitting…" : mode === "preview" ? "Finish preview" : "Submit quiz"}
      </button>
    </div>
  );
}
