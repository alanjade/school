import { describe, expect, it } from "vitest";
import { groupQuestions } from "@/lib/quizAttemptRows";
import type { QuizAttemptQuestionRow } from "@/types/database";

const base = {
  question_text: "Q",
  points: 1,
  question_sequence: 1,
  selected_option_id: null,
  answer_text: null,
  matched_pairs: null,
};

function row(over: Partial<QuizAttemptQuestionRow>): QuizAttemptQuestionRow {
  return {
    ...base,
    question_id: "q",
    question_type: "mcq",
    option_id: null,
    option_text: null,
    match_prompt: null,
    option_sequence: null,
    ...over,
  };
}

describe("groupQuestions", () => {
  it("builds matching left terms from left rows and the dropdown pool from pool rows", () => {
    const rows = [
      // left rows: id + prompt, no answer text
      row({
        question_id: "m",
        question_type: "matching",
        option_id: "l1",
        match_prompt: "France",
        option_sequence: 1,
      }),
      row({
        question_id: "m",
        question_type: "matching",
        option_id: "l2",
        match_prompt: "Japan",
        option_sequence: 2,
      }),
      // pool rows: text only
      row({ question_id: "m", question_type: "matching", option_text: "Paris" }),
      row({ question_id: "m", question_type: "matching", option_text: "Tokyo" }),
    ];
    const [q] = groupQuestions(rows).questions;

    expect(q.options).toEqual([
      { id: "l1", text: "", matchPrompt: "France" },
      { id: "l2", text: "", matchPrompt: "Japan" },
    ]);
    expect(q.pool).toEqual(["Paris", "Tokyo"]);
  });

  it("never pairs a prompt with a text on the client", () => {
    const rows = [
      row({ question_id: "m", question_type: "matching", option_id: "l1", match_prompt: "France" }),
      row({ question_id: "m", question_type: "matching", option_text: "Paris" }),
    ];
    const [q] = groupQuestions(rows).questions;
    expect(q.options.every((o) => o.text === "")).toBe(true);
  });

  it("keeps mcq choices as options with no pool", () => {
    const rows = [
      row({ question_id: "c", option_id: "a", option_text: "A", option_sequence: 1 }),
      row({ question_id: "c", option_id: "b", option_text: "B", option_sequence: 2 }),
    ];
    const [q] = groupQuestions(rows).questions;
    expect(q.options.map((o) => o.text)).toEqual(["A", "B"]);
    expect(q.pool).toEqual([]);
  });

  it("yields no options or pool for the single option-less row of fill_blank/essay", () => {
    const { questions } = groupQuestions([
      row({ question_id: "f", question_type: "fill_blank" }),
      row({ question_id: "e", question_type: "essay" }),
    ]);
    expect(questions.map((q) => [q.options.length, q.pool.length])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("restores the student's saved answers from any row of the question", () => {
    const saved = { l1: "Paris" };
    const { selected, text, matched } = groupQuestions([
      row({ question_id: "c", option_id: "a", option_text: "A", selected_option_id: "a" }),
      row({ question_id: "f", question_type: "fill_blank", answer_text: "my guess" }),
      row({
        question_id: "m",
        question_type: "matching",
        option_id: "l1",
        match_prompt: "France",
        matched_pairs: saved,
      }),
      row({ question_id: "m", question_type: "matching", option_text: "Paris" }),
    ]);
    expect(selected).toEqual({ c: "a" });
    expect(text).toEqual({ f: "my guess" });
    expect(matched).toEqual({ m: saved });
  });
});
