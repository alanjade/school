import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueueSupabaseMock, type MockResult } from "./helpers/supabaseMock";

const { getUserWithRetry } = vi.hoisted(() => ({ getUserWithRetry: vi.fn() }));
const adminState = vi.hoisted(() => ({
  queue: [] as MockResult[],
  client: null as ReturnType<typeof createQueueSupabaseMock> | null,
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({})),
  getUserWithRetry,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    adminState.client ??= createQueueSupabaseMock(adminState.queue);
    return adminState.client;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { updateQuizQuestions } from "@/lib/actions/quiz";
import type { QuizQuestionInput } from "@/lib/quizValidation";

const goodQuestions: QuizQuestionInput[] = [
  {
    questionText: "2 + 2?",
    questionType: "mcq",
    points: 2,
    options: [
      { text: "3", isCorrect: false },
      { text: "4", isCorrect: true },
    ],
  },
];

function mockAuthenticatedAs(userId: string) {
  getUserWithRetry.mockResolvedValue({ user: { id: userId }, error: null, isTransient: false });
}

const asTeacher: MockResult = { data: { role: "teacher", is_active: true }, error: null };
const asAdmin: MockResult = { data: { role: "admin", is_active: true }, error: null };
const quizRow = (published: boolean): MockResult => ({
  data: { assessment_id: "assessment-1", is_published: published },
  error: null,
});
const owner = (id: string): MockResult => ({ data: { created_by: id }, error: null });
const attempts = (n: number) =>
  ({ data: null, error: null, count: n }) as MockResult & { count: number };
const ok: MockResult = { data: null, error: null };

afterEach(() => {
  vi.clearAllMocks();
  adminState.queue = [];
  adminState.client = null;
});

describe("updateQuizQuestions", () => {
  it("lets the quiz's owner replace the questions of an unpublished, unattempted quiz", async () => {
    mockAuthenticatedAs("teacher-1");
    adminState.queue = [
      asTeacher,
      quizRow(false),
      owner("teacher-1"),
      attempts(0),
      ok /* rpc */,
      ok /* audit */,
    ];

    expect(await updateQuizQuestions("quiz-1", goodQuestions)).toEqual({ ok: true });
    expect(adminState.client!.rpc).toHaveBeenCalledWith(
      "replace_quiz_questions",
      expect.objectContaining({ p_quiz_id: "quiz-1" })
    );
  });

  it("lets an admin edit any quiz without an ownership check", async () => {
    mockAuthenticatedAs("admin-1");
    adminState.queue = [asAdmin, quizRow(false), attempts(0), ok, ok];

    expect(await updateQuizQuestions("quiz-1", goodQuestions)).toEqual({ ok: true });
  });

  it("rejects a teacher editing someone else's quiz", async () => {
    mockAuthenticatedAs("teacher-1");
    adminState.queue = [asTeacher, quizRow(false), owner("teacher-2")];

    expect(await updateQuizQuestions("quiz-1", goodQuestions)).toEqual({
      ok: false,
      error: "You can only edit your own quizzes.",
    });
  });

  it("rejects editing a published quiz", async () => {
    mockAuthenticatedAs("teacher-1");
    adminState.queue = [asTeacher, quizRow(true), owner("teacher-1")];

    expect(await updateQuizQuestions("quiz-1", goodQuestions)).toEqual({
      ok: false,
      error: "Unpublish this quiz before editing its questions.",
    });
  });

  it("rejects editing once students have attempted the quiz", async () => {
    mockAuthenticatedAs("teacher-1");
    adminState.queue = [asTeacher, quizRow(false), owner("teacher-1"), attempts(3)];

    expect(await updateQuizQuestions("quiz-1", goodQuestions)).toEqual({
      ok: false,
      error: "3 student attempts already exist, so the questions can't be changed.",
    });
  });

  it("rejects invalid questions before writing anything", async () => {
    mockAuthenticatedAs("teacher-1");
    adminState.queue = [asTeacher, quizRow(false), owner("teacher-1"), attempts(0)];

    const result = await updateQuizQuestions("quiz-1", [
      { ...goodQuestions[0], options: [{ text: "only one", isCorrect: true }] },
    ]);
    expect(result).toEqual({ ok: false, error: "Question 1 needs at least two options." });
    expect(adminState.client!.rpc).not.toHaveBeenCalled();
  });

  it("surfaces a database-side rejection as a returned error", async () => {
    mockAuthenticatedAs("teacher-1");
    adminState.queue = [
      asTeacher,
      quizRow(false),
      owner("teacher-1"),
      attempts(0),
      { data: null, error: { message: "boom", code: "P0001" } },
    ];

    const result = await updateQuizQuestions("quiz-1", goodQuestions);
    expect(result.ok).toBe(false);
  });
});
