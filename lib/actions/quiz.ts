"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/actions/authGuards";
import { writeAuditLog } from "@/lib/audit";
import { throwDbError } from "@/lib/errors/db";
import { quizWindowError } from "@/lib/quizWindow";
import {
  questionsToRpcPayload,
  validateQuizQuestions,
  type QuizQuestionInput,
} from "@/lib/quizValidation";
import { runAction, type ActionResult } from "@/lib/actionResult";

type QuestionInput = QuizQuestionInput;

async function insertQuiz(input: {
  title: string;
  subjectId: string;
  classId: string;
  term: number;
  academicYear: string;
  durationMinutes: number;
  opensAt?: string;
  closesAt?: string;
  // Opt-in per-quiz: when true, get_quiz_attempt_questions serves each
  // student a different (but stable-for-that-attempt) question order
  // instead of the authored sequence_order. Defaults to off server-side
  // too (see 20260806170100_quiz_shuffle_questions.sql), so omitting this
  // keeps existing create-quiz callers unaffected.
  shuffleQuestions?: boolean;
  questions: QuestionInput[];
}) {
  const { id: actorId, role: actorRole } = await assertRole(
    ["admin", "teacher"],
    "Only an admin or a teacher can create a quiz."
  );

  const windowError = quizWindowError(input.opensAt, input.closesAt);
  if (windowError) throw new Error(windowError);

  // Teachers may only create quizzes for subjects they're assigned to.
  // RLS (assessments_write_teacher_admin) only checks created_by, not
  // subjects_taught, so this has to be enforced here.
  if (actorRole === "teacher") {
    const admin = createAdminClient();
    const { data: teacherProfile, error: teacherError } = await admin
      .from("teacher_profiles")
      .select("subjects_taught")
      .eq("id", actorId)
      .single();
    if (teacherError) throwDbError(teacherError);

    const assignedSubjects = teacherProfile?.subjects_taught ?? [];
    if (!assignedSubjects.includes(input.subjectId)) {
      throw new Error("You can only create quizzes for subjects you teach.");
    }
  }

  if (!input.title.trim()) throw new Error("Title is required.");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1) {
    throw new Error("Duration must be a whole number of minutes.");
  }
  validateQuizQuestions(input.questions);

  const admin = createAdminClient();

  // One RPC call = one Postgres transaction (see
  // 20260805170100_create_quiz_with_questions_rpc.sql) -- if question 3 of 5
  // fails to insert, the whole thing rolls back instead of leaving
  // questions 1-2 (and the quiz/assessment rows) orphaned.
  const { data: quizId, error } = await admin.rpc("create_quiz_with_questions", {
    p_subject_id: input.subjectId,
    p_class_id: input.classId,
    p_title: input.title.trim(),
    p_term: input.term,
    p_academic_year: input.academicYear,
    p_created_by: actorId,
    p_duration_minutes: input.durationMinutes,
    p_opens_at: input.opensAt || null,
    p_closes_at: input.closesAt || null,
    p_shuffle_questions: input.shuffleQuestions ?? false,
    p_questions: questionsToRpcPayload(input.questions),
  });
  if (error) throwDbError(error);

  // Quiz creation had no audit trail at all before this -- unlike
  // gradesModeration.ts's admin approvals, which already log every
  // moderation action. A quiz is a form of assessment (it creates its
  // own `assessments` row), so it deserves the same accountability:
  // who created it, for which subject/class, how many questions/points.
  await writeAuditLog({
    entityType: "quiz",
    entityId: quizId as string,
    action: "quiz_created",
    actorId,
    metadata: {
      title: input.title.trim(),
      subject_id: input.subjectId,
      class_id: input.classId,
      term: input.term,
      academic_year: input.academicYear,
      question_count: input.questions.length,
      total_points: input.questions.reduce((sum, q) => sum + q.points, 0),
      shuffle_questions: input.shuffleQuestions ?? false,
    },
  });

  revalidatePath("/dashboard/teacher/quizzes");
  return quizId as string;
}

/** Returns failures as values -- thrown messages are redacted in production (see lib/actionResult.ts). */
export async function createQuiz(
  input: Parameters<typeof insertQuiz>[0]
): Promise<ActionResult<string>> {
  return runAction(() => insertQuiz(input));
}

/**
 * Replace a quiz's questions. Only while the quiz is unpublished and nobody
 * has attempted it: recorded answers point at question/option ids, so
 * changing questions under existing attempts would corrupt their scores. The
 * database function re-checks both rules under a row lock.
 */
export async function updateQuizQuestions(
  quizId: string,
  questions: QuizQuestionInput[]
): Promise<ActionResult> {
  return runAction(async () => {
    const { id: actorId, role: actorRole } = await assertRole(
      ["admin", "teacher"],
      "Only an admin or teacher can do this."
    );
    const admin = createAdminClient();

    const { data: quiz } = await admin
      .from("quizzes")
      .select("assessment_id, is_published")
      .eq("id", quizId)
      .single();
    if (!quiz) throw new Error("Quiz not found.");

    if (actorRole === "teacher") {
      const { data: assessment } = await admin
        .from("assessments")
        .select("created_by")
        .eq("id", quiz.assessment_id)
        .single();
      if (assessment?.created_by !== actorId) {
        throw new Error("You can only edit your own quizzes.");
      }
    }

    if (quiz.is_published) {
      throw new Error("Unpublish this quiz before editing its questions.");
    }

    const { count: attemptCount } = await admin
      .from("quiz_attempts")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quizId);
    if (attemptCount) {
      throw new Error(
        `${attemptCount} student attempt${attemptCount === 1 ? "" : "s"} already exist, so the questions can't be changed.`
      );
    }

    validateQuizQuestions(questions);

    const { error } = await admin.rpc("replace_quiz_questions", {
      p_quiz_id: quizId,
      p_questions: questionsToRpcPayload(questions),
    });
    if (error) throwDbError(error);

    await writeAuditLog({
      entityType: "quiz",
      entityId: quizId,
      action: "quiz_questions_edited",
      actorId,
      metadata: {
        question_count: questions.length,
        total_points: questions.reduce((sum, q) => sum + q.points, 0),
      },
    });

    revalidatePath("/dashboard/teacher/quizzes");
    revalidatePath(`/dashboard/teacher/quizzes/${quizId}`);
    revalidatePath(`/dashboard/teacher/quizzes/${quizId}/preview`);
  });
}

/**
 * Change when a quiz opens/closes. Only allowed while it's unpublished --
 * once students can see it, the window is what they planned around.
 * Passing undefined/empty clears that bound.
 */
export async function updateQuizSchedule(
  quizId: string,
  schedule: { opensAt?: string; closesAt?: string }
): Promise<ActionResult> {
  return runAction(async () => {
    const { id: actorId, role: actorRole } = await assertRole(
      ["admin", "teacher"],
      "Only an admin or teacher can do this."
    );
    const admin = createAdminClient();

    const { data: quiz } = await admin
      .from("quizzes")
      .select("assessment_id, is_published")
      .eq("id", quizId)
      .single();
    if (!quiz) throw new Error("Quiz not found.");

    if (actorRole === "teacher") {
      const { data: assessment } = await admin
        .from("assessments")
        .select("created_by")
        .eq("id", quiz.assessment_id)
        .single();
      if (assessment?.created_by !== actorId) {
        throw new Error("You can only change the schedule of your own quizzes.");
      }
    }

    if (quiz.is_published) {
      throw new Error("Unpublish this quiz before changing its schedule.");
    }

    const windowError = quizWindowError(schedule.opensAt, schedule.closesAt);
    if (windowError) throw new Error(windowError);

    const { error } = await admin
      .from("quizzes")
      .update({
        opens_at: schedule.opensAt || null,
        closes_at: schedule.closesAt || null,
      })
      .eq("id", quizId);
    if (error) throwDbError(error);

    revalidatePath("/dashboard/teacher/quizzes");
    revalidatePath(`/dashboard/teacher/quizzes/${quizId}`);
  });
}

// Fetches a quiz's questions/options (including is_correct and accepted
// answers) for a teacher/admin dry-run — never creates a quiz_attempts
// row and never touches quiz_answers/grades. Runs on the caller's own
// session (not the admin client): RLS's quiz_questions_select_staff /
// quiz_options_select_staff policies already restrict these tables to
// is_admin() or is_quiz_owner(quiz_id), so a teacher previewing a quiz
// they don't own simply gets an empty question list back, same as any
// other RLS-filtered read in this app — no extra ownership check needed
// here.
export async function getQuizPreviewQuestions(quizId: string) {
  return runAction(async () => {
    await assertRole(["admin", "teacher"], "Only an admin or teacher can preview a quiz.");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("quiz_questions")
      .select(
        "id, question_text, question_type, points, sequence_order, quiz_options(id, option_text, match_prompt, is_correct, sequence_order)"
      )
      .eq("quiz_id", quizId)
      .order("sequence_order", { ascending: true });
    if (error) throwDbError(error);
    return data;
  });
}

export type QuestionAnalytics = {
  questionId: string;
  questionText: string;
  questionType: QuestionInput["questionType"];
  points: number;
  sequenceOrder: number;
  attemptedCount: number; // submitted attempts that answered this question
  skippedCount: number; // submitted attempts that left it blank
  // mcq/true_false only: how many picked each option, correct one flagged.
  optionBreakdown?: { optionId: string; text: string; isCorrect: boolean; count: number }[];
  // fill_blank/matching/mcq/true_false: fraction who got full points.
  correctCount?: number;
  // essay only: how many of the attempted answers have been graded yet.
  gradedCount?: number;
  // Average points earned on this question across attempts that
  // answered it (ungraded essays count as 0 until graded).
  avgPoints: number;
};

// Aggregates per-question performance across every *submitted* attempt on
// a quiz: how many picked each option (mcq/true_false), how many got full
// credit (fill_blank/matching), average points earned, and how many
// skipped the question entirely. Read-only — runs on the caller's own
// session, same RLS staff policies (can_grade_quiz/is_quiz_owner/is_admin)
// that already gate quiz_questions/quiz_options/quiz_answers reads for
// the quiz detail page, so a teacher who doesn't own or teach this quiz's
// subject just gets nothing back rather than an authorization error.
export async function getQuizQuestionAnalytics(quizId: string): Promise<{
  totalSubmitted: number;
  questions: QuestionAnalytics[];
}> {
  await assertRole(["admin", "teacher"], "Only an admin or teacher can view quiz analytics.");
  const supabase = createClient();

  const { data: questions, error: qError } = await supabase
    .from("quiz_questions")
    .select(
      "id, question_text, question_type, points, sequence_order, quiz_options(id, option_text, match_prompt, is_correct, sequence_order)"
    )
    .eq("quiz_id", quizId)
    .order("sequence_order", { ascending: true });
  if (qError) throwDbError(qError);

  const { data: submittedAttempts, error: aError } = await supabase
    .from("quiz_attempts")
    .select("id")
    .eq("quiz_id", quizId)
    .not("submitted_at", "is", null);
  if (aError) throwDbError(aError);

  const attemptIds = (submittedAttempts ?? []).map((a) => a.id);
  const totalSubmitted = attemptIds.length;

  type AnswerRow = {
    attempt_id: string;
    question_id: string;
    selected_option_id: string | null;
    answer_text: string | null;
    matched_pairs: Record<string, string> | null;
    points_awarded: number | null;
  };

  const { data: answers, error: ansError } = attemptIds.length
    ? await supabase
        .from("quiz_answers")
        .select(
          "attempt_id, question_id, selected_option_id, answer_text, matched_pairs, points_awarded"
        )
        .in("attempt_id", attemptIds)
    : { data: [] as AnswerRow[], error: null };
  if (ansError) throwDbError(ansError);

  const answersByQuestion = new Map<string, AnswerRow[]>();
  for (const row of answers ?? []) {
    if (!answersByQuestion.has(row.question_id)) answersByQuestion.set(row.question_id, []);
    answersByQuestion.get(row.question_id)!.push(row);
  }

  const result: QuestionAnalytics[] = (questions ?? []).map((q) => {
    const qAnswers = answersByQuestion.get(q.id) ?? [];
    const attemptedCount = qAnswers.length;
    const skippedCount = Math.max(0, totalSubmitted - attemptedCount);
    const options = (q.quiz_options ?? []).sort((a, b) => a.sequence_order - b.sequence_order);

    if (q.question_type === "mcq" || q.question_type === "true_false") {
      const counts = new Map<string, number>();
      for (const a of qAnswers) {
        if (!a.selected_option_id) continue;
        counts.set(a.selected_option_id, (counts.get(a.selected_option_id) ?? 0) + 1);
      }
      const correctCount = qAnswers.filter(
        (a) =>
          a.selected_option_id && options.find((o) => o.id === a.selected_option_id)?.is_correct
      ).length;
      return {
        questionId: q.id,
        questionText: q.question_text,
        questionType: q.question_type,
        points: q.points,
        sequenceOrder: q.sequence_order,
        attemptedCount,
        skippedCount,
        correctCount,
        optionBreakdown: options.map((o) => ({
          optionId: o.id,
          text: o.option_text,
          isCorrect: o.is_correct,
          count: counts.get(o.id) ?? 0,
        })),
        avgPoints: attemptedCount ? (correctCount / attemptedCount) * q.points : 0,
      };
    }

    if (q.question_type === "fill_blank") {
      const accepted = options
        .filter((o) => o.is_correct)
        .map((o) => o.option_text.trim().toLowerCase());
      const correctCount = qAnswers.filter(
        (a) => a.answer_text && accepted.includes(a.answer_text.trim().toLowerCase())
      ).length;
      return {
        questionId: q.id,
        questionText: q.question_text,
        questionType: q.question_type,
        points: q.points,
        sequenceOrder: q.sequence_order,
        attemptedCount,
        skippedCount,
        correctCount,
        avgPoints: attemptedCount ? (correctCount / attemptedCount) * q.points : 0,
      };
    }

    if (q.question_type === "matching") {
      // Same all-or-nothing rule as submit_quiz_attempt: every canonical
      // pair (option_id -> option_text) must appear correctly in
      // matched_pairs for the attempt to count as correct.
      const correctCount = qAnswers.filter((a) => {
        if (!a.matched_pairs || !options.length) return false;
        return options.every(
          (o) =>
            (a.matched_pairs?.[o.id] ?? "").trim().toLowerCase() ===
            o.option_text.trim().toLowerCase()
        );
      }).length;
      return {
        questionId: q.id,
        questionText: q.question_text,
        questionType: q.question_type,
        points: q.points,
        sequenceOrder: q.sequence_order,
        attemptedCount,
        skippedCount,
        correctCount,
        avgPoints: attemptedCount ? (correctCount / attemptedCount) * q.points : 0,
      };
    }

    // essay: no auto-correctness, average whatever has been graded so
    // far (ungraded answers contribute 0, same as submit-time scoring).
    const gradedCount = qAnswers.filter((a) => a.points_awarded !== null).length;
    const totalAwarded = qAnswers.reduce((sum, a) => sum + (a.points_awarded ?? 0), 0);
    return {
      questionId: q.id,
      questionText: q.question_text,
      questionType: q.question_type,
      points: q.points,
      sequenceOrder: q.sequence_order,
      attemptedCount,
      skippedCount,
      gradedCount,
      avgPoints: attemptedCount ? totalAwarded / attemptedCount : 0,
    };
  });

  return { totalSubmitted, questions: result };
}

async function updatePublished(quizId: string, isPublished: boolean) {
  const { id: actorId, role: actorRole } = await assertRole(
    ["admin", "teacher"],
    "Only an admin or teacher can do this."
  );
  const admin = createAdminClient();

  // Teachers may only publish/unpublish their own quizzes. Admins can
  // toggle any quiz — same ownership model as the quiz-preview RLS
  // (is_quiz_owner / is_admin). Using the admin client for the ownership
  // look-up bypasses any RLS gap that might let a teacher read another
  // teacher's assessment row via the session client.
  if (actorRole === "teacher") {
    const { data: quiz } = await admin
      .from("quizzes")
      .select("assessment_id")
      .eq("id", quizId)
      .single();

    if (!quiz) throw new Error("Quiz not found.");

    const { data: assessment } = await admin
      .from("assessments")
      .select("created_by")
      .eq("id", quiz.assessment_id)
      .single();

    if (assessment?.created_by !== actorId) {
      throw new Error("You can only publish your own quizzes.");
    }
  }

  if (isPublished) {
    // Publishing a quiz that has already closed would put something on
    // students' lists that nobody can take. This is where "edit the schedule
    // before publishing" matters.
    const { data: window } = await admin
      .from("quizzes")
      .select("closes_at")
      .eq("id", quizId)
      .single();
    if (window?.closes_at && new Date(window.closes_at).getTime() < Date.now()) {
      throw new Error(
        "This quiz's closing time has already passed. Edit its schedule before publishing."
      );
    }
  }

  const { error } = await admin
    .from("quizzes")
    .update({ is_published: isPublished })
    .eq("id", quizId);
  if (error) throwDbError(error);

  revalidatePath("/dashboard/teacher/quizzes");
  revalidatePath(`/dashboard/teacher/quizzes/${quizId}`);
}

/** Returns failures as values -- thrown messages are redacted in production (see lib/actionResult.ts). */
export async function setQuizPublished(
  quizId: string,
  isPublished: boolean
): Promise<ActionResult> {
  return runAction(() => updatePublished(quizId, isPublished));
}

// Awards points for one or more essay answers on an already-submitted
// attempt and recomputes that attempt's total score. `scores` maps
// question id -> points awarded; a teacher can grade essays one at a
// time across visits, each call only touches the questions it's given.
export async function gradeQuizEssayAnswers(
  quizId: string,
  attemptId: string,
  scores: Record<string, number>
) {
  return runAction(async () => {
    await assertRole(["admin", "teacher"], "Only an admin or teacher can do this.");

    // Runs as the caller's own session (not the admin client) — the RPC is
    // SECURITY DEFINER and checks auth.uid() against is_admin()/
    // subjects_taught internally, same pattern the student-facing RPCs in
    // quizAttempt.ts already use. It also bounds-checks each score against
    // that question's max points (2026_08_07b) and writes its own
    // audit_log row ('quiz_attempt' / 'quiz_essay_graded') -- don't add a
    // second writeAuditLog call here like a previous pass did; that just
    // produced two entries for the same grading action, one from the RPC
    // and one from here.
    const supabase = createClient();
    const { error } = await supabase.rpc("grade_quiz_essay_answers", {
      p_attempt_id: attemptId,
      p_scores: scores,
    });
    if (error) throwDbError(error);

    revalidatePath(`/dashboard/teacher/quizzes/${quizId}`);
  });
}
