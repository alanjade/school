"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createQuiz, updateQuizQuestions } from "@/lib/actions/quiz";
import { validateQuizQuestions } from "@/lib/quizValidation";
import { joinDateTime, localIsoDate, quizWindowError, splitDateTime } from "@/lib/quizWindow";
import { emitToast } from "@/lib/toast";
import { QuestionText } from "@/components/QuestionText";
import { MathInsertButton } from "@/components/MathInsertButton";
import { TimeSelect } from "@/components/TimeSelect";
import { type EducationLevel } from "@/types/database";

const LEVEL_LABELS: Record<EducationLevel, string> = {
  primary: "Primary",
  jss: "Junior Secondary (JSS)",
  sss: "Senior Secondary (SS)",
};

export type QuestionType = "mcq" | "true_false" | "fill_blank" | "matching" | "essay";
export type OptionDraft = { text: string; isCorrect: boolean; matchPrompt?: string };
export type QuestionDraft = {
  questionText: string;
  questionType: QuestionType;
  points: number;
  options: OptionDraft[];
};

function blankOptionsFor(type: QuestionType): OptionDraft[] {
  switch (type) {
    case "true_false":
      return [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ];
    case "fill_blank":
      return [{ text: "", isCorrect: true }];
    case "matching":
      return [
        { text: "", isCorrect: true, matchPrompt: "" },
        { text: "", isCorrect: true, matchPrompt: "" },
      ];
    case "essay":
      return [];
    case "mcq":
    default:
      return [
        { text: "", isCorrect: false },
        { text: "", isCorrect: false },
      ];
  }
}

function blankQuestion(): QuestionDraft {
  return {
    questionText: "",
    questionType: "mcq",
    points: 1,
    options: blankOptionsFor("mcq"),
  };
}

// datetime-local's native picker popup is date-only in several browsers
// (Firefox included) -- the time has to be edited directly inside the
// input's own time segment instead, which is easy to miss and reads as
// "time isn't editable". Splitting into separate date + time inputs
// keeps a real, always-visible native time control while still storing
// a single "YYYY-MM-DDTHH:mm" string, same shape datetime-local used.
// Neither field is gated on the other being filled first -- a teacher
// can set the time before the date (or vice versa); joinDateTime fills
// in today's date / midnight for whichever side is still blank so the
// combined value stays valid either way.
export function QuizBuilder({
  subjects = [],
  classes = [],
  academicYear = "",
  term = 1,
  editQuiz,
}: {
  /** Set to edit an existing quiz's questions instead of creating a new quiz. */
  editQuiz?: { quizId: string; title: string; questions: QuestionDraft[] };
  subjects?: {
    id: string;
    name: string;
    education_level: EducationLevel;
    min_level_number: number;
    max_level_number: number;
  }[];
  classes?: { id: string; label: string }[];
  academicYear?: string;
  term?: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [durationMinutes, setDurationMinutes] = useState("20");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [questions, setQuestions] = useState<QuestionDraft[]>(
    editQuiz?.questions.length ? editQuiz.questions : [blankQuestion()]
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // One textarea ref per question, keyed by index, so MathInsertButton
  // can splice its $...$ / $$...$$ snippet in at the caret instead of
  // just appending to the end of questionText.
  const questionTextRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
  // Same idea, one ref per *option* field, keyed by "qIndex-oIndex-field"
  // ("text" or "matchPrompt" for matching's left-hand side) -- options
  // are plain <input>s, not textareas, but selectionStart/End and
  // setSelectionRange work identically on both.
  const optionRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function insertMathSnippet(index: number, snippet: string) {
    const el = questionTextRefs.current.get(index);
    const current = questions[index].questionText;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + snippet + current.slice(end);
    updateQuestion(index, { questionText: next });
    const cursor = start + snippet.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  function insertOptionMathSnippet(
    qIndex: number,
    oIndex: number,
    field: "text" | "matchPrompt",
    snippet: string
  ) {
    const key = `${qIndex}-${oIndex}-${field}`;
    const el = optionRefs.current.get(key);
    const current = (questions[qIndex].options[oIndex][field] ?? "") as string;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + snippet + current.slice(end);
    updateOption(qIndex, oIndex, { [field]: next } as Partial<OptionDraft>);
    const cursor = start + snippet.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  function setQuestionType(index: number, type: QuestionType) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === index ? { ...q, questionType: type, options: blankOptionsFor(type) } : q
      )
    );
  }

  function updateOption(qIndex: number, oIndex: number, patch: Partial<OptionDraft>) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIndex
          ? {
              ...q,
              options: q.options.map((o, j) => (j === oIndex ? { ...o, ...patch } : o)),
            }
          : q
      )
    );
  }

  function markCorrect(qIndex: number, oIndex: number) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIndex
          ? { ...q, options: q.options.map((o, j) => ({ ...o, isCorrect: j === oIndex })) }
          : q
      )
    );
  }

  function addOption(qIndex: number) {
    setQuestions((qs) =>
      qs.map((q, i) => {
        if (i !== qIndex) return q;
        const newRow: OptionDraft =
          q.questionType === "fill_blank"
            ? { text: "", isCorrect: true }
            : q.questionType === "matching"
              ? { text: "", isCorrect: true, matchPrompt: "" }
              : { text: "", isCorrect: false };
        return { ...q, options: [...q.options, newRow] };
      })
    );
  }

  function removeOption(qIndex: number, oIndex: number) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIndex ? { ...q, options: q.options.filter((_, j) => j !== oIndex) } : q
      )
    );
  }

  function addQuestion() {
    setQuestions((qs) => [...qs, blankQuestion()]);
  }

  function removeQuestion(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index));
  }

  const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

  function handleEditSubmit() {
    if (!editQuiz) return;
    const payload = questions.map((q) => ({
      questionText: q.questionText,
      questionType: q.questionType,
      points: Number(q.points) || 0,
      options: q.options.map((o) => ({
        text: o.text,
        isCorrect: o.isCorrect,
        matchPrompt: o.matchPrompt,
      })),
    }));
    try {
      validateQuizQuestions(payload);
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Check the questions and try again.");
    }

    startTransition(async () => {
      const result = await updateQuizQuestions(editQuiz.quizId, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      emitToast("Questions updated.");
      router.push(`/dashboard/teacher/quizzes/${editQuiz.quizId}`);
      router.refresh();
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (editQuiz) return handleEditSubmit();

    if (!title.trim()) return setError("Title is required.");
    if (!subjectId || !classId) return setError("Pick a subject and class.");
    const windowError = quizWindowError(opensAt, closesAt);
    if (windowError) return setError(windowError);

    startTransition(async () => {
      {
        const result = await createQuiz({
          title,
          subjectId,
          classId,
          term,
          academicYear,
          durationMinutes: Number(durationMinutes),
          opensAt: opensAt ? new Date(opensAt).toISOString() : undefined,
          closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
          shuffleQuestions,
          questions: questions.map((q) => ({
            questionText: q.questionText,
            questionType: q.questionType,
            points: Number(q.points) || 1,
            options: q.options.map((o) => ({
              text: o.text,
              isCorrect: o.isCorrect,
              matchPrompt: o.matchPrompt,
            })),
          })),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        emitToast("Quiz created — publish it when you're ready.");
        router.push(`/dashboard/teacher/quizzes/${result.data}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {editQuiz ? (
        <div className="rounded-xl border border-rule bg-white p-4 text-sm text-ink-soft">
          Editing the questions of <span className="font-medium text-ink">{editQuiz.title}</span>.
          Title, class and schedule are unchanged — use Edit schedule on the quiz page for dates.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-rule bg-white p-4">
          <input
            required
            placeholder="Quiz title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="col-span-2 rounded-lg border border-rule px-3 py-2 text-sm outline-none focus-visible:border-marigold"
          />
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="rounded-lg border border-rule px-3 py-2 text-sm"
          >
            {(["primary", "jss", "sss"] as EducationLevel[])
              .map((level) => ({
                level,
                items: subjects.filter((s) => s.education_level === level),
              }))
              .filter(({ items }) => items.length > 0)
              .map(({ level, items }) => (
                <optgroup key={level} label={LEVEL_LABELS[level]}>
                  {items.map((s) => {
                    const range =
                      s.min_level_number === s.max_level_number
                        ? `${s.min_level_number}`
                        : `${s.min_level_number}–${s.max_level_number}`;
                    return (
                      <option key={s.id} value={s.id}>
                        {s.name} ({range})
                      </option>
                    );
                  })}
                </optgroup>
              ))}
          </select>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="rounded-lg border border-rule px-3 py-2 text-sm"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink-soft">
            Duration (minutes)
            <input
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="w-24 rounded-lg border border-rule px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            Opens at (optional)
            <div className="flex gap-2">
              <input
                type="date"
                min={localIsoDate()}
                value={splitDateTime(opensAt).date}
                onChange={(e) =>
                  setOpensAt(joinDateTime(e.target.value, splitDateTime(opensAt).time))
                }
                className="min-w-0 flex-1 rounded-lg border border-rule px-3 py-2 text-sm"
              />
              <TimeSelect
                value={splitDateTime(opensAt).time}
                onChangeAction={(time) =>
                  setOpensAt(joinDateTime(splitDateTime(opensAt).date, time))
                }
              />
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            Closes at (optional)
            <div className="flex gap-2">
              <input
                type="date"
                min={localIsoDate()}
                value={splitDateTime(closesAt).date}
                onChange={(e) =>
                  setClosesAt(joinDateTime(e.target.value, splitDateTime(closesAt).time))
                }
                className="min-w-0 flex-1 rounded-lg border border-rule px-3 py-2 text-sm"
              />
              <TimeSelect
                value={splitDateTime(closesAt).time}
                onChangeAction={(time) =>
                  setClosesAt(joinDateTime(splitDateTime(closesAt).date, time))
                }
              />
            </div>
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={(e) => setShuffleQuestions(e.target.checked)}
              className="h-4 w-4 rounded border-rule"
            />
            Shuffle question order for each student
          </label>
        </div>
      )}

      <div className="space-y-4">
        {questions.map((q, qIndex) => (
          <div key={qIndex} className="rounded-xl border border-rule bg-white p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-ink">Question {qIndex + 1}</p>
              {questions.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeQuestion(qIndex)}
                  className="text-xs text-clay hover:underline"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="mb-1.5 flex items-center justify-end">
              <MathInsertButton onInsertAction={(snippet) => insertMathSnippet(qIndex, snippet)} />
            </div>
            <textarea
              ref={(el) => {
                if (el) questionTextRefs.current.set(qIndex, el);
                else questionTextRefs.current.delete(qIndex);
              }}
              required
              placeholder="Question text"
              value={q.questionText}
              onChange={(e) => updateQuestion(qIndex, { questionText: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-rule px-3 py-2 text-sm outline-none focus-visible:border-marigold"
            />
            {/* Live preview -- the textarea itself  show the
                raw "$x^2$" source, so without this a teacher has no way to
                tell superscripts/subscripts/fractions/etc. are actually
                well-formed until a student hits the quiz. Same
                markdown+KaTeX pipeline QuizAttemptRunner uses to render
                this exact question_text to students, so what's previewed
                here is exactly what they'll see. */}
            {q.questionText.trim() && (
              <div className="mb-3 mt-1.5 rounded-lg border border-dashed border-rule bg-paper px-3 py-2">
                <QuestionText text={q.questionText} />
              </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-3">
              <select
                value={q.questionType}
                onChange={(e) => setQuestionType(qIndex, e.target.value as QuestionType)}
                className="rounded-lg border border-rule px-3 py-2 text-sm"
              >
                <option value="mcq">Multiple choice</option>
                <option value="true_false">True / False</option>
                <option value="fill_blank">Fill in the blank</option>
                <option value="matching">Matching</option>
                <option value="essay">Essay</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                Points
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={q.points}
                  onChange={(e) => updateQuestion(qIndex, { points: Number(e.target.value) })}
                  className="w-16 rounded-lg border border-rule px-2 py-1 text-sm"
                />
              </label>
            </div>

            {(q.questionType === "mcq" || q.questionType === "true_false") && (
              <div className="space-y-2">
                {q.options.map((o, oIndex) => (
                  <div key={oIndex} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`correct-${qIndex}`}
                      checked={o.isCorrect}
                      onChange={() => markCorrect(qIndex, oIndex)}
                      aria-label="Correct answer"
                      className="mt-2.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <input
                          ref={(el) => {
                            const key = `${qIndex}-${oIndex}-text`;
                            if (el) optionRefs.current.set(key, el);
                            else optionRefs.current.delete(key);
                          }}
                          required
                          disabled={q.questionType === "true_false"}
                          placeholder={`Option ${oIndex + 1}`}
                          value={o.text}
                          onChange={(e) => updateOption(qIndex, oIndex, { text: e.target.value })}
                          className="flex-1 rounded-lg border border-rule px-3 py-2 text-sm outline-none focus-visible:border-marigold disabled:bg-paper"
                        />
                        {/* True/false options are the fixed strings
                            "True"/"False" (disabled above) -- math entry
                            on them would never be rendered anywhere, so
                            skip the button rather than offer a dead
                            control. */}
                        {q.questionType === "mcq" && (
                          <MathInsertButton
                            onInsertAction={(snippet) =>
                              insertOptionMathSnippet(qIndex, oIndex, "text", snippet)
                            }
                          />
                        )}
                        {q.questionType === "mcq" && q.options.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeOption(qIndex, oIndex)}
                            className="text-xs text-clay hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {/* Same live-preview pattern as questionText below --
                          renders exactly what QuizAttemptRunner shows
                          students for this option (QuestionText is the
                          shared component both use), so a teacher isn't
                          guessing whether "$x^2$" actually came out right. */}
                      {q.questionType === "mcq" && o.text.trim() && (
                        <div className="mt-1 rounded-lg border border-dashed border-rule bg-paper px-3 py-1.5">
                          <QuestionText text={o.text} className="inline" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {q.questionType === "mcq" && (
                  <button
                    type="button"
                    onClick={() => addOption(qIndex)}
                    className="text-xs text-leaf hover:underline"
                  >
                    + Add option
                  </button>
                )}
              </div>
            )}

            {q.questionType === "fill_blank" && (
              <div className="space-y-2">
                <p className="text-xs text-ink-soft">
                  Accepted answers (any one matches, case-insensitive)
                </p>
                {q.options.map((o, oIndex) => (
                  <div key={oIndex} className="flex items-center gap-2">
                    <input
                      required={oIndex === 0}
                      placeholder={`Accepted answer ${oIndex + 1}`}
                      value={o.text}
                      onChange={(e) => updateOption(qIndex, oIndex, { text: e.target.value })}
                      className="flex-1 rounded-lg border border-rule px-3 py-2 text-sm outline-none focus-visible:border-marigold"
                    />
                    {q.options.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeOption(qIndex, oIndex)}
                        className="text-xs text-clay hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(qIndex)}
                  className="text-xs text-leaf hover:underline"
                >
                  + Add another accepted answer
                </button>
              </div>
            )}

            {q.questionType === "matching" && (
              <div className="space-y-2">
                <p className="text-xs text-ink-soft">Pairs students will match left to right</p>
                {/* Note: the prompt side renders with math below, same as
                    everywhere else. The match/answer side (o.text) can't
                    -- it doubles as the literal value in a native
                    <select><option> on the student's side
                    (QuizAttemptRunner), and browsers render <option>
                    content as plain text only, with no HTML/KaTeX
                    support. So math entry is offered on the prompt but
                    intentionally not on the match text, rather than
                    letting a teacher build an answer that can never
                    actually display for students. */}
                {q.options.map((o, oIndex) => (
                  <div key={oIndex} className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <input
                          ref={(el) => {
                            const key = `${qIndex}-${oIndex}-matchPrompt`;
                            if (el) optionRefs.current.set(key, el);
                            else optionRefs.current.delete(key);
                          }}
                          required
                          placeholder={`Prompt ${oIndex + 1}`}
                          value={o.matchPrompt ?? ""}
                          onChange={(e) =>
                            updateOption(qIndex, oIndex, { matchPrompt: e.target.value })
                          }
                          className="flex-1 rounded-lg border border-rule px-3 py-2 text-sm outline-none focus-visible:border-marigold"
                        />
                        <MathInsertButton
                          onInsertAction={(snippet) =>
                            insertOptionMathSnippet(qIndex, oIndex, "matchPrompt", snippet)
                          }
                        />
                      </div>
                      {(o.matchPrompt ?? "").trim() && (
                        <div className="mt-1 rounded-lg border border-dashed border-rule bg-paper px-3 py-1.5">
                          <QuestionText text={o.matchPrompt ?? ""} className="inline" />
                        </div>
                      )}
                    </div>
                    <span className="mt-2.5 text-ink-soft">→</span>
                    <input
                      required
                      placeholder={`Match ${oIndex + 1}`}
                      value={o.text}
                      onChange={(e) => updateOption(qIndex, oIndex, { text: e.target.value })}
                      className="flex-1 rounded-lg border border-rule px-3 py-2 text-sm outline-none focus-visible:border-marigold"
                    />
                    {q.options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(qIndex, oIndex)}
                        className="mt-2.5 text-xs text-clay hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(qIndex)}
                  className="text-xs text-leaf hover:underline"
                >
                  + Add pair
                </button>
              </div>
            )}

            {q.questionType === "essay" && (
              <p className="rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">
                Students answer in free text. You&apos;ll score this yourself after they submit — it
                won&apos;t count toward their score automatically.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addQuestion}
          className="rounded-lg border border-rule px-3 py-2 text-sm font-medium text-ink hover:bg-leaf-soft"
        >
          + Add question
        </button>
        <p className="text-sm text-ink-soft">
          Total: {totalPoints} point{totalPoints === 1 ? "" : "s"}
        </p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-leaf px-4 py-2 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
      >
        {editQuiz
          ? isPending
            ? "Saving…"
            : "Save questions"
          : isPending
            ? "Creating…"
            : "Create quiz"}
      </button>

      {error && <p className="text-sm text-clay">{error}</p>}
    </form>
  );
}
