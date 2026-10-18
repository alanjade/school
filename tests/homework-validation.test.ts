import { describe, expect, it } from "vitest";
import { cleanHomeworkFields, HOMEWORK_MAX_LENGTH, isIsoDate } from "@/lib/homeworkValidation";

describe("isIsoDate", () => {
  it("accepts real dates and rejects malformed or impossible ones", () => {
    expect(isIsoDate("2026-10-07")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("07/10/2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});

describe("cleanHomeworkFields", () => {
  const lessonDate = "2026-10-07";

  it("trims the text and normalises a missing due date to null", () => {
    expect(cleanHomeworkFields({ homework: "  Read ch. 3  ", lessonDate })).toEqual({
      homework: "Read ch. 3",
      homeworkDueAt: null,
    });
    expect(
      cleanHomeworkFields({ homework: "x", homeworkDueAt: "  ", lessonDate }).homeworkDueAt
    ).toBeNull();
  });

  it("requires homework text", () => {
    expect(() => cleanHomeworkFields({ homework: "   ", lessonDate })).toThrow(
      "Write what the students should do."
    );
  });

  it("caps the length", () => {
    expect(() =>
      cleanHomeworkFields({ homework: "a".repeat(HOMEWORK_MAX_LENGTH + 1), lessonDate })
    ).toThrow("too long");
  });

  it("allows a due date on or after the lesson date, not before", () => {
    expect(
      cleanHomeworkFields({ homework: "x", homeworkDueAt: lessonDate, lessonDate }).homeworkDueAt
    ).toBe(lessonDate);
    expect(() =>
      cleanHomeworkFields({ homework: "x", homeworkDueAt: "2026-10-06", lessonDate })
    ).toThrow("Homework due date can't be before the lesson date.");
  });

  it("rejects a malformed due date", () => {
    expect(() =>
      cleanHomeworkFields({ homework: "x", homeworkDueAt: "tomorrow", lessonDate })
    ).toThrow("That due date isn't valid.");
  });
});
