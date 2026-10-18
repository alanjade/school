import { describe, expect, it } from "vitest";
import {
  questionsToRpcPayload,
  validateQuizQuestions,
  type QuizQuestionInput,
} from "@/lib/quizValidation";

const mcq = (over: Partial<QuizQuestionInput> = {}): QuizQuestionInput => ({
  questionText: "2 + 2?",
  questionType: "mcq",
  points: 1,
  options: [
    { text: "3", isCorrect: false },
    { text: "4", isCorrect: true },
  ],
  ...over,
});

describe("validateQuizQuestions", () => {
  it("accepts a valid question of every type", () => {
    expect(() =>
      validateQuizQuestions([
        mcq(),
        mcq({
          questionType: "true_false",
          options: [
            { text: "True", isCorrect: true },
            { text: "False", isCorrect: false },
          ],
        }),
        mcq({ questionType: "fill_blank", options: [{ text: "four", isCorrect: true }] }),
        mcq({
          questionType: "matching",
          options: [
            { text: "x", matchPrompt: "a", isCorrect: true },
            { text: "y", matchPrompt: "b", isCorrect: true },
          ],
        }),
        mcq({ questionType: "essay", options: [] }),
      ])
    ).not.toThrow();
  });

  it("requires at least one question", () => {
    expect(() => validateQuizQuestions([])).toThrow("Add at least one question.");
  });

  it("requires question text and positive points", () => {
    expect(() => validateQuizQuestions([mcq({ questionText: "  " })])).toThrow(
      "Question 1 needs text."
    );
    expect(() => validateQuizQuestions([mcq(), mcq({ points: 0 })])).toThrow(
      "Question 2 needs points greater than zero."
    );
    expect(() => validateQuizQuestions([mcq({ points: Number.NaN })])).toThrow(
      "Question 1 needs points greater than zero."
    );
  });

  it("requires a correct option and no blank options on mcq", () => {
    expect(() =>
      validateQuizQuestions([
        mcq({
          options: [
            { text: "a", isCorrect: false },
            { text: "b", isCorrect: false },
          ],
        }),
      ])
    ).toThrow("Question 1 needs a correct option marked.");
    expect(() =>
      validateQuizQuestions([
        mcq({
          options: [
            { text: "a", isCorrect: true },
            { text: " ", isCorrect: false },
          ],
        }),
      ])
    ).toThrow("Question 1 has an empty option.");
  });

  it("requires accepted answers for fill_blank and complete pairs for matching", () => {
    expect(() =>
      validateQuizQuestions([
        mcq({ questionType: "fill_blank", options: [{ text: "", isCorrect: true }] }),
      ])
    ).toThrow("Question 1 needs at least one accepted answer.");
    expect(() =>
      validateQuizQuestions([
        mcq({
          questionType: "matching",
          options: [
            { text: "x", matchPrompt: "a", isCorrect: true },
            { text: "y", matchPrompt: "", isCorrect: true },
          ],
        }),
      ])
    ).toThrow("Question 1 has an incomplete pair.");
  });
});

describe("questionsToRpcPayload", () => {
  it("trims text, drops blank options, and marks every fill_blank answer correct", () => {
    const [q] = questionsToRpcPayload([
      mcq({
        questionText: "  Capital of France?  ",
        questionType: "fill_blank",
        options: [
          { text: " Paris ", isCorrect: false },
          { text: "", isCorrect: false },
        ],
      }),
    ]);
    expect(q.question_text).toBe("Capital of France?");
    expect(q.options).toEqual([{ text: "Paris", match_prompt: null, is_correct: true }]);
  });
});
