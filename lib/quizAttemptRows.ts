import type { QuizAttemptQuestionRow } from "@/types/database";

export type QuizRunnerQuestion = {
  id: string;
  text: string;
  points: number;
  type: QuizAttemptQuestionRow["question_type"];
  // mcq/true_false: the choices. matching: the LEFT terms (id + matchPrompt;
  // text is empty -- the right-hand answer is never sent to a student).
  // fill_blank/essay: always empty.
  options: { id: string; text: string; matchPrompt: string | null }[];
  // matching only: the right-hand terms for the dropdowns, detached from
  // the prompts they belong to.
  pool: string[];
};

// get_quiz_attempt_questions returns, per question:
//   - mcq/true_false: one row per choice (option_id + option_text);
//   - fill_blank/essay: a single row with every option column null;
//   - matching: "left" rows (option_id + match_prompt, option_text null) and
//     "pool" rows (option_id null, only option_text). A pool row is
//     recognised by option_text being set with no option_id.
// The server never ships accepted answers or prompt->answer pairs while an
// attempt is in progress, so nothing here can reconstruct them.
export function groupQuestions(rows: QuizAttemptQuestionRow[]): {
  questions: QuizRunnerQuestion[];
  selected: Record<string, string>;
  text: Record<string, string>;
  matched: Record<string, Record<string, string>>;
} {
  const byId = new Map<string, QuizRunnerQuestion>();
  const selected: Record<string, string> = {};
  const text: Record<string, string> = {};
  const matched: Record<string, Record<string, string>> = {};

  for (const r of rows) {
    if (!byId.has(r.question_id)) {
      byId.set(r.question_id, {
        id: r.question_id,
        text: r.question_text,
        points: r.points,
        type: r.question_type,
        options: [],
        pool: [],
      });
    }
    const q = byId.get(r.question_id)!;
    if (r.option_id) {
      q.options.push({ id: r.option_id, text: r.option_text ?? "", matchPrompt: r.match_prompt });
    } else if (r.option_text !== null) {
      q.pool.push(r.option_text);
    }
    if (r.selected_option_id) selected[r.question_id] = r.selected_option_id;
    if (r.answer_text) text[r.question_id] = r.answer_text;
    if (r.matched_pairs) matched[r.question_id] = r.matched_pairs;
  }

  return { questions: [...byId.values()], selected, text, matched };
}
