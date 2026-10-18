"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/actions/authGuards";
import { writeAuditLog } from "@/lib/audit";
import { videoEmbedUrl } from "@/lib/video-embed";
import { fetchLinkMetadata } from "@/lib/linkPreview";
import { TOPIC_RESOURCE_BUCKET } from "@/lib/storageBuckets";
import type {
  AssessmentType,
  AttendanceStatus,
  HomeworkStatus,
  ResourceType,
} from "@/types/database";
import { throwDbError } from "@/lib/errors/db";
import { runAction, type ActionResult } from "@/lib/actionResult";

// ---------- Lessons ----------

async function insertLesson(input: {
  timetableEntryId: string;
  classId: string;
  lessonDate: string;
  topicId?: string;
  objectives?: string;
  homework?: string;
  homeworkDueAt?: string;
}) {
  const { id: teacherId } = await assertRole(["teacher"], "Only teachers can log lessons.");

  const supabase = createClient();

  const { data: entry } = await supabase
    .from("timetable_entries")
    .select("teacher_id, class_id, classes(name, arm)")
    .eq("id", input.timetableEntryId)
    .single();

  if (!entry) {
    throw new Error("Timetable entry not found.");
  }

  if (entry.teacher_id !== teacherId) {
    const className = entry.classes?.name ?? "this class";
    throw new Error(`You aren't assigned to this period for ${className}.`);
  }

  if (entry.class_id !== input.classId) {
    throw new Error("Class doesn't match this timetable entry.");
  }

  if (input.homeworkDueAt && !input.homework) {
    throw new Error("Set the homework text before giving it a due date.");
  }

  if (input.homeworkDueAt && input.homeworkDueAt < input.lessonDate) {
    throw new Error("Homework due date can't be before the lesson date.");
  }

  const { data: lesson, error } = await supabase
    .from("lessons")
    .insert({
      timetable_entry_id: input.timetableEntryId,
      class_id: input.classId,
      teacher_id: teacherId,
      lesson_date: input.lessonDate,
      topic_id: input.topicId || null,
      objectives: input.objectives || null,
      homework: input.homework || null,
      homework_due_at: input.homeworkDueAt || null,
    })
    .select("id")
    .single();

  if (error) throwDbError(error);

  revalidatePath("/dashboard/teacher");
  revalidatePath("/dashboard/teacher/attendance");
  return { lessonId: lesson.id };
}

/** Returns failures as values -- thrown messages are redacted in production (see lib/actionResult.ts). */
export async function createLesson(
  input: Parameters<typeof insertLesson>[0]
): Promise<ActionResult<{ lessonId: string }>> {
  return runAction(() => insertLesson(input));
}

export async function updateHomeworkStatus(lessonId: string, status: HomeworkStatus) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(
      ["teacher"],
      "Only teachers can update homework status."
    );

    const supabase = createClient();

    const { data: lesson } = await supabase
      .from("lessons")
      .select("teacher_id")
      .eq("id", lessonId)
      .single();

    if (!lesson || lesson.teacher_id !== teacherId) {
      throw new Error("You aren't the teacher assigned to this lesson.");
    }

    const { error } = await supabase
      .from("lessons")
      .update({ homework_status: status })
      .eq("id", lessonId);

    if (error) throwDbError(error);

    revalidatePath("/dashboard/teacher/homework");
    revalidatePath("/dashboard/student/homework");
    revalidatePath("/dashboard/parent/homework");
  });
}

// ---------- Attendance ----------

export async function markAttendance(
  classId: string,
  date: string,
  records: { studentId: string; status: AttendanceStatus }[]
) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can mark attendance.");

    const supabase = createClient();

    const { data: klass } = await supabase
      .from("classes")
      .select("name, arm, class_teacher_id")
      .eq("id", classId)
      .single();

    if (!klass) {
      throw new Error("Class not found.");
    }

    if (klass.class_teacher_id !== teacherId) {
      throw new Error(`You aren't the class teacher for ${klass.name} ${klass.arm ?? ""}.`.trim());
    }

    const rows = records.map((r) => ({
      class_id: classId,
      student_id: r.studentId,
      date,
      status: r.status,
      marked_by: teacherId,
    }));

    const { error } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "class_id,student_id,date" });

    if (error) throwDbError(error);

    revalidatePath(`/dashboard/teacher/attendance/${classId}/${date}`);
    revalidatePath("/dashboard/teacher/attendance");
    for (const studentId of new Set(records.map((r) => r.studentId))) {
      revalidatePath(`/dashboard/admin/students/${studentId}/attendance`);
    }
  });
}

// ---------- Grades ----------

export async function saveGrade(
  assessmentId: string,
  studentId: string,
  score: number,
  remark?: string
) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can enter grades.");

    const supabase = createClient();

    const { data: assessment } = await supabase
      .from("assessments")
      .select("subject_id, class_id, max_score, subjects(name), classes(name, arm)")
      .eq("id", assessmentId)
      .single();

    if (!assessment) {
      throw new Error("Assessment not found.");
    }

    if (!Number.isFinite(score) || score < 0 || score > assessment.max_score) {
      throw new Error(`Score must be between 0 and ${assessment.max_score}.`);
    }

    const { data: assignment } = await supabase
      .from("timetable_entries")
      .select("id")
      .eq("teacher_id", teacherId)
      .eq("subject_id", assessment.subject_id)
      .eq("class_id", assessment.class_id)
      .limit(1)
      .maybeSingle();

    if (!assignment) {
      const subjectName = assessment.subjects?.name ?? "this subject";
      const className = assessment.classes?.name ?? "this class";
      throw new Error(
        `You aren't assigned to teach ${subjectName} for ${className}, so you can't enter grades for it.`
      );
    }

    const { error } = await supabase.from("grades").upsert(
      {
        assessment_id: assessmentId,
        student_id: studentId,
        score,
        remark: remark ?? null,
        graded_by: teacherId,
        // Saving always (re)submits for review -- a grade an HOD rejected
        // goes back to pending here, and the old rejection note is cleared.
        moderation_status: "pending",
        review_note: null,
        reviewed_by: null,
        reviewed_at: null,
      },
      { onConflict: "assessment_id,student_id" }
    );

    if (error) throwDbError(error);

    // Regular teacher grade entry had no audit trail before this --
    // gradesModeration.ts already logs admin/HOD *approvals*, but not the
    // actual score being typed in that gets approved. `entity_type: "grade"`
    // matches what that file uses so both show up together under the same
    // filter in /dashboard/admin/audit-log, rather than needing a second
    // category. Not distinguishing create vs. update here -- upsert makes
    // that a second query just to check, and "someone set this score to
    // X" is the fact that matters for an audit trail either way.
    await writeAuditLog({
      entityType: "grade",
      entityId: assessmentId,
      action: "grade_saved",
      actorId: teacherId,
      metadata: { student_id: studentId, score, max_score: assessment.max_score },
    });

    revalidatePath(`/dashboard/teacher/grades/${assessmentId}`);
    revalidatePath("/dashboard/admin/grades");
    revalidatePath(`/dashboard/admin/students/${studentId}/grades`);
    revalidatePath("/dashboard/student/grades");
  });
}

export async function importGrades(
  assessmentId: string,
  entries: { admissionNo: string; score: number; remark?: string }[]
) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can import grades.");
    if (!entries.length) throw new Error("Add at least one grade row to import.");

    const supabase = createClient();
    const { data: assessment } = await supabase
      .from("assessments")
      .select("subject_id, class_id, max_score")
      .eq("id", assessmentId)
      .single();

    if (!assessment) throw new Error("Assessment not found.");

    const { data: assignment } = await supabase
      .from("timetable_entries")
      .select("id")
      .eq("teacher_id", teacherId)
      .eq("subject_id", assessment.subject_id)
      .eq("class_id", assessment.class_id)
      .limit(1)
      .maybeSingle();

    if (!assignment) throw new Error("You aren't assigned to this assessment's class and subject.");

    const admissionNumbers = entries.map((entry) => entry.admissionNo.trim());
    if (admissionNumbers.some((number) => !number))
      throw new Error("Every row needs an admission number.");
    if (new Set(admissionNumbers).size !== admissionNumbers.length) {
      throw new Error("Each admission number may only appear once in an import.");
    }
    if (
      entries.some(
        (entry) =>
          !Number.isFinite(entry.score) || entry.score < 0 || entry.score > assessment.max_score
      )
    ) {
      throw new Error(`Scores must be between 0 and ${assessment.max_score}.`);
    }

    const { data: roster } = await supabase
      .from("student_profiles")
      .select("id, admission_no")
      .eq("class_id", assessment.class_id)
      .in("admission_no", admissionNumbers);

    const studentByAdmission = new Map(
      (roster ?? []).map((student) => [student.admission_no, student.id])
    );
    const unknown = admissionNumbers.filter((number) => !studentByAdmission.has(number));
    if (unknown.length)
      throw new Error(`No student in this class has admission number: ${unknown.join(", ")}.`);

    const { error } = await supabase.from("grades").upsert(
      entries.map((entry) => ({
        assessment_id: assessmentId,
        student_id: studentByAdmission.get(entry.admissionNo.trim())!,
        score: entry.score,
        remark: entry.remark?.trim() || null,
        graded_by: teacherId,
        moderation_status: "pending" as const,
        review_note: null,
        reviewed_by: null,
        reviewed_at: null,
      })),
      { onConflict: "assessment_id,student_id" }
    );

    if (error) throwDbError(error);

    revalidatePath(`/dashboard/teacher/grades/${assessmentId}`);
    revalidatePath("/dashboard/admin/grades");
  });
}

// ---------- Assessments ----------

async function assertTeacherAssignedTo(
  supabase: ReturnType<typeof createClient>,
  teacherId: string,
  subjectId: string,
  classId: string
) {
  // A teacher can have multiple timetable periods for the same
  // subject/class (e.g. Mon period 2 + Wed period 4), so this can
  // legitimately match more than one row — use limit(1) instead of
  // maybeSingle(), which errors out (and was being silently swallowed
  // here) whenever more than one row matched.
  const { data: assignment } = await supabase
    .from("timetable_entries")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("subject_id", subjectId)
    .eq("class_id", classId)
    .limit(1)
    .maybeSingle();

  if (!assignment) {
    throw new Error("You aren't assigned to teach this subject for this class.");
  }
}

const STANDARD_ASSESSMENTS = [
  { title: "1st CA", max_score: 20, assessment_type: "first_ca" as const },
  { title: "2nd CA", max_score: 20, assessment_type: "second_ca" as const },
  { title: "Exam", max_score: 60, assessment_type: "exam" as const },
];

// Shared by createStandardAssessmentSet (single subject/class) and
// createStandardAssessmentSetForAllMyClasses (bulk, one call per
// distinct timetabled subject/class combo). Caller is responsible for
// the assertTeacherAssignedTo check -- the bulk path derives its combos
// directly from timetable_entries, so it's already guaranteed assigned
// and re-checking per combo would just be a redundant round trip.
async function createStandardSetFor(
  supabase: ReturnType<typeof createClient>,
  teacherId: string,
  subjectId: string,
  classId: string,
  term: number,
  academicYear: string
) {
  const { data: existing } = await supabase
    .from("assessments")
    .select("assessment_type")
    .eq("subject_id", subjectId)
    .eq("class_id", classId)
    .eq("term", term)
    .eq("academic_year", academicYear);

  const existingTypes = new Set((existing ?? []).map((a) => a.assessment_type));
  const toCreate = STANDARD_ASSESSMENTS.filter((a) => !existingTypes.has(a.assessment_type));

  if (!toCreate.length) {
    return { created: [] as string[] };
  }

  const { data: created, error } = await supabase
    .from("assessments")
    .insert(
      toCreate.map((a) => ({
        subject_id: subjectId,
        class_id: classId,
        title: a.title,
        assessment_type: a.assessment_type,
        max_score: a.max_score,
        term,
        academic_year: academicYear,
        created_by: teacherId,
      }))
    )
    .select("id, title");

  if (error) throwDbError(error);

  // One entry per assessment (not one entry for the whole batch) so each
  // shows up individually in /dashboard/admin/audit-log under its own
  // entity_id -- consistent with how a single createCustomAssessment
  // call logs one entry per assessment it creates.
  await Promise.all(
    (created ?? []).map((assessment) =>
      writeAuditLog({
        entityType: "assessment",
        entityId: assessment.id,
        action: "assessment_created",
        actorId: teacherId,
        metadata: {
          kind: "standard_set",
          title: assessment.title,
          subject_id: subjectId,
          class_id: classId,
          term,
          academic_year: academicYear,
        },
      })
    )
  );

  return { created: toCreate.map((a) => `${a.title} (${a.max_score})`) };
}

export async function createStandardAssessmentSet(input: {
  subjectId: string;
  classId: string;
  term: number;
  academicYear: string;
}) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(
      ["teacher"],
      "Only teachers can create assessments."
    );

    const supabase = createClient();
    await assertTeacherAssignedTo(supabase, teacherId, input.subjectId, input.classId);

    const result = await createStandardSetFor(
      supabase,
      teacherId,
      input.subjectId,
      input.classId,
      input.term,
      input.academicYear
    );

    revalidatePath("/dashboard/teacher/grades");
    revalidatePath("/dashboard/admin/grades");
    return result;
  });
}

export type BulkStandardSetResult = {
  subjectId: string;
  className: string;
  subjectName: string;
  created: string[];
};

// Creates the standard set (1st CA + 2nd CA + Exam) for every distinct
// subject/class the calling teacher is timetabled for this term, in one
// call, instead of requiring the teacher to repeat the single-subject
// flow above once per subject. Combos derive straight from
// timetable_entries (the same source assertTeacherAssignedTo checks
// against), so there's no risk of creating assessments for a subject/
// class the teacher isn't actually assigned to.
export async function createStandardAssessmentSetForAllMyClasses(input: {
  term: number;
  academicYear: string;
}) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(
      ["teacher"],
      "Only teachers can create assessments."
    );
    const supabase = createClient();

    const { data: entries, error } = await supabase
      .from("timetable_entries")
      .select("subject_id, class_id, subjects(name), classes(name, arm)")
      .eq("teacher_id", teacherId);

    if (error) throwDbError(error);

    // A teacher can have several periods a week for the same subject/class
    // (e.g. Mon + Wed) -- dedupe down to distinct subject/class combos
    // before creating anything, so we don't attempt the same combo twice.
    const seen = new Map<
      string,
      { subjectId: string; classId: string; subjectName: string; className: string }
    >();
    for (const e of entries ?? []) {
      const key = `${e.subject_id}:${e.class_id}`;
      if (seen.has(key)) continue;
      const className = e.classes
        ? `${e.classes.name}${e.classes.arm ? ` ${e.classes.arm}` : ""}`
        : "";
      seen.set(key, {
        subjectId: e.subject_id,
        classId: e.class_id,
        subjectName: e.subjects?.name ?? "",
        className,
      });
    }

    const results: BulkStandardSetResult[] = [];
    for (const combo of seen.values()) {
      const { created } = await createStandardSetFor(
        supabase,
        teacherId,
        combo.subjectId,
        combo.classId,
        input.term,
        input.academicYear
      );
      results.push({
        subjectId: combo.subjectId,
        subjectName: combo.subjectName,
        className: combo.className,
        created,
      });
    }

    revalidatePath("/dashboard/teacher/grades");
    revalidatePath("/dashboard/admin/grades");
    return { results };
  });
}

export async function createCustomAssessment(input: {
  subjectId: string;
  classId: string;
  term: number;
  academicYear: string;
  assessmentType: AssessmentType;
  title: string;
  maxScore: number;
}) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(
      ["teacher"],
      "Only teachers can create assessments."
    );
    if (!input.title.trim()) {
      throw new Error("Enter a title for this assessment.");
    }

    const supabase = createClient();
    await assertTeacherAssignedTo(supabase, teacherId, input.subjectId, input.classId);

    const { data: created, error } = await supabase
      .from("assessments")
      .insert({
        subject_id: input.subjectId,
        class_id: input.classId,
        title: input.title,
        assessment_type: input.assessmentType,
        max_score: input.maxScore,
        term: input.term,
        academic_year: input.academicYear,
        created_by: teacherId,
      })
      .select("id")
      .single();

    if (error) throwDbError(error);

    await writeAuditLog({
      entityType: "assessment",
      entityId: created.id,
      action: "assessment_created",
      actorId: teacherId,
      metadata: {
        kind: "custom",
        title: input.title,
        assessment_type: input.assessmentType,
        max_score: input.maxScore,
        subject_id: input.subjectId,
        class_id: input.classId,
        term: input.term,
        academic_year: input.academicYear,
      },
    });

    revalidatePath("/dashboard/teacher/grades");
    revalidatePath("/dashboard/admin/grades");
  });
}

// ---------- Note authoring ----------

export async function saveTopicNote(
  topicId: string,
  content: string,
  status: "draft" | "published"
) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can author notes.");

    const supabase = createClient();

    const { data: latest } = await supabase
      .from("topic_notes")
      .select("version")
      .eq("topic_id", topicId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Publishing goes through the same HOD review gate as grades: a new
    // publish starts 'pending' and stays invisible to everyone but the
    // author/admin/that subject's HOD until reviewed (see
    // topic_note_visible() + notes_update_hod in the lesson-plan-approval
    // migration). The one exception is a HOD publishing their own note for
    // their own subject -- there's no one else to review it, so it
    // auto-approves, same as how grades_insert_assigned_teacher still
    // requires a HOD's own submitted grades to go through
    // grades_update_hod... except unlike grades, a solo HOD here would
    // otherwise be stuck unable to ever publish anything, so auto-approve
    // is the deliberate difference. A draft's moderation_status is never
    // read while it's still a draft (topic_note_visible short-circuits on
    // status first), so 'approved' there is just an inert default.
    let moderationStatus: "approved" | "pending" = "approved";
    if (status === "published") {
      const [{ data: topic }, { data: teacher }] = await Promise.all([
        supabase.from("curriculum_topics").select("subject_id").eq("id", topicId).single(),
        supabase
          .from("teacher_profiles")
          .select("staff_role, subjects_taught")
          .eq("id", teacherId)
          .single(),
      ]);
      const isHodOfThisSubject =
        teacher?.staff_role === "hod" &&
        !!topic?.subject_id &&
        !!teacher.subjects_taught?.includes(topic.subject_id);
      moderationStatus = isHodOfThisSubject ? "approved" : "pending";
    }

    // Notes are append-only: publishing a revision never overwrites an
    // earlier draft or published copy, so teachers can review the full
    // topic history later and students continue seeing the latest publish.
    const { data: note, error } = await supabase
      .from("topic_notes")
      .insert({
        topic_id: topicId,
        author_id: teacherId,
        content,
        status,
        moderation_status: moderationStatus,
        version: (latest?.version ?? 0) + 1,
      })
      .select("id")
      .single();

    if (error) throwDbError(error);

    // The autosave scratch row (if any) is now superseded by this real,
    // version-tracked save -- delete it so a stale autosave never lingers
    // as "recoverable" content the teacher already explicitly saved past.
    // Best-effort: a failure here shouldn't fail the save itself.
    try {
      await supabase
        .from("topic_note_drafts")
        .delete()
        .eq("topic_id", topicId)
        .eq("author_id", teacherId);
    } catch {
      // ignore -- worst case a harmless stale draft banner shows next load
    }

    revalidatePath(`/dashboard/teacher/notes/${topicId}`);
    revalidatePath("/dashboard/teacher/notes");

    return note;
  });
}

/**
 * Periodic autosave (#13 of markdown-editor-todo.md), UPSERTing onto a
 * single scratch row per (topic, author) rather than creating another
 * `topic_notes` version -- see the migration comment in
 * 20260803170000_topic_note_drafts.sql for why that distinction matters.
 * Deliberately quiet: called on an interval from NoteEditor while the
 * doc is dirty, not meant to throw a user-facing toast on every network
 * hiccup the way an explicit Save Draft click should.
 */
export async function saveTopicNoteDraft(topicId: string, content: string) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can author notes.");
    const supabase = createClient();
    const { error } = await supabase
      .from("topic_note_drafts")
      .upsert(
        { topic_id: topicId, author_id: teacherId, content, updated_at: new Date().toISOString() },
        { onConflict: "topic_id,author_id" }
      );
    if (error) throwDbError(error);
  });
}

/**
 * Checked once when a teacher opens a note, to offer recovering
 * unsaved work from a tab/browser that closed uncleanly (crash, battery
 * death, network drop right as they navigated away) -- the case the
 * existing `beforeunload` warning can't catch, since that only fires
 * for a clean, in-app navigation attempt.
 */
export async function getTopicNoteDraft(
  topicId: string
): Promise<ActionResult<{ content: string; updatedAt: string } | null>> {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can author notes.");
    const supabase = createClient();
    const { data } = await supabase
      .from("topic_note_drafts")
      .select("content, updated_at")
      .eq("topic_id", topicId)
      .eq("author_id", teacherId)
      .maybeSingle();
    return data ? { content: data.content, updatedAt: data.updated_at } : null;
  });
}

export async function clearTopicNoteDraft(topicId: string) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can author notes.");
    const supabase = createClient();
    await supabase
      .from("topic_note_drafts")
      .delete()
      .eq("topic_id", topicId)
      .eq("author_id", teacherId);
  });
}

/**
 * Fetches one version's content on demand for the version-diff view.
 * Deliberately not bundled into the initial version-history list query
 * (which only selects id/version/status/moderation_status/updated_at) --
 * note bodies can be a few paragraphs each, and most page loads never
 * open the diff view, so there's no reason to pull every version's full
 * text up front.
 *
 * Uses the session-scoped client, not createAdminClient(), so the same
 * topic_note_visible() RLS rule that already governs who can read a note
 * (author, admin, that subject's HOD, or any teacher/student/parent once
 * approved) applies here too -- this doesn't open up any access a caller
 * couldn't already get by reading the note directly.
 */
export async function getTopicNoteVersionContent(noteId: string): Promise<ActionResult<string>> {
  return runAction(async () => {
    await assertRole(["admin", "teacher"], "Only teaching staff can compare lesson plan versions.");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("topic_notes")
      .select("content")
      .eq("id", noteId)
      .single();

    if (error || !data) {
      throw new Error(
        "That version isn't available (it may have been removed, or you don't have access to it)."
      );
    }
    return data.content;
  });
}

/**
 * Restores an older version as the note's current content. Like
 * `saveTopicNote`, this is append-only -- it never overwrites or deletes
 * the version being restored *from*, or any version in between. It reads
 * that version's content and inserts it as a brand-new version on top,
 * so "restore" is really "re-save the old content as the newest save".
 * That keeps the full history intact (the fact that a restore happened
 * is itself just another row) and means undo-ing a bad restore is the
 * same "restore an older version" action, not a special case.
 *
 * Restored content always comes back in as a 'draft', regardless of
 * whether the version being restored was published -- matches
 * `saveTopicNote`'s own moderation gate: re-publishing something old
 * still ought to go through the same HOD review a fresh publish would,
 * rather than silently reinstating a possibly-outdated approval.
 */
export async function restoreTopicNoteVersion(topicId: string, versionNoteId: string) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can author notes.");
    const supabase = createClient();

    const { data: source, error: sourceError } = await supabase
      .from("topic_notes")
      .select("content, topic_id")
      .eq("id", versionNoteId)
      .single();

    if (sourceError || !source) {
      throw new Error(
        "That version isn't available (it may have been removed, or you don't have access to it)."
      );
    }
    // Defends against a stale/tampered `versionNoteId` from a different
    // topic ever landing in this topic's history -- the version picker only
    // ever offers versions already scoped to `topicId`, so this should be
    // unreachable in normal use, but it's a cheap check against a crafted
    // request.
    if (source.topic_id !== topicId) {
      throw new Error("That version doesn't belong to this topic.");
    }

    const { data: latest } = await supabase
      .from("topic_notes")
      .select("version")
      .eq("topic_id", topicId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: restored, error } = await supabase
      .from("topic_notes")
      .insert({
        topic_id: topicId,
        author_id: teacherId,
        content: source.content,
        status: "draft",
        moderation_status: "approved",
        version: (latest?.version ?? 0) + 1,
      })
      .select("id")
      .single();

    if (error) throwDbError(error);

    revalidatePath(`/dashboard/teacher/notes/${topicId}`);
    revalidatePath("/dashboard/teacher/notes");

    return restored;
  });
}

/**
 * Deletes a single version from a note's history. Guardrails beyond RLS
 * (which is scoped the same as edit access -- author, admin, or a
 * teacher on that subject):
 *
 * 1. Refuses to delete the last remaining version -- a note's history
 *    can shrink, but it can never go to zero rows out from under
 *    whatever page is currently rendering "the note".
 * 2. Resources (`topic_resources.note_id`) attached to the version being
 *    deleted: `note_id` only records which version a resource was
 *    uploaded *under*, not every version whose content still references
 *    it (a save carries forward whatever `[[resource:UUID]]` markers
 *    were already in the content). Each attached resource is checked
 *    against every surviving version's content -- if still referenced
 *    elsewhere, it's reassigned to that version instead of deleted;
 *    only truly-unreferenced resources are hard-deleted (storage
 *    object + row). This applies the same way whether the version
 *    being deleted is the current one or an older one -- deleting the
 *    current version is allowed and simply falls back to whatever is
 *    now the highest remaining `version` number, same as if that
 *    version had never been saved.
 */
export async function deleteTopicNoteVersion(topicId: string, versionNoteId: string) {
  return runAction(async () => {
    await assertRole(["teacher", "admin"], "Only teaching staff can manage lesson plan versions.");
    const supabase = createClient();

    const { data: target, error: targetError } = await supabase
      .from("topic_notes")
      .select("topic_id")
      .eq("id", versionNoteId)
      .single();

    if (targetError || !target) {
      throw new Error(
        "That version isn't available (it may have already been removed, or you don't have access to it)."
      );
    }
    if (target.topic_id !== topicId) {
      throw new Error("That version doesn't belong to this topic.");
    }

    const { data: allVersions } = await supabase
      .from("topic_notes")
      .select("id, version")
      .eq("topic_id", topicId)
      .order("version", { ascending: false });

    if ((allVersions?.length ?? 0) <= 1) {
      throw new Error("Can't delete the only version of this note.");
    }

    const { data: attachedResources } = await supabase
      .from("topic_resources")
      .select("id, file_url")
      .eq("note_id", versionNoteId);

    if (attachedResources && attachedResources.length > 0) {
      // `note_id` on a resource records whichever version was *current at
      // upload time* and is never updated afterward -- it does NOT track
      // every version whose content actually renders that resource. A
      // save carries the editor's full content (including any
      // `[[resource:UUID]]` markers already in it) forward into a brand
      // new version row, so the same resource can still be referenced by
      // the *current* version's content, or any other surviving version's
      // content, even though `note_id` points here. Hard-deleting by
      // `note_id` alone would silently break that other version's
      // rendering (a marker with no backing row) the next time anyone
      // views or restores it.
      //
      // So: only hard-delete a resource if its UUID marker doesn't appear
      // in any version that will still exist after this delete. If it
      // does still appear somewhere, reassign `note_id` to one of those
      // surviving versions instead (the newest one that references it) --
      // that keeps the FK satisfied and the resource reachable from
      // wherever it's actually still in use, rather than losing it.
      const { data: survivingVersions } = await supabase
        .from("topic_notes")
        .select("id, version, content")
        .eq("topic_id", topicId)
        .neq("id", versionNoteId)
        .order("version", { ascending: false });

      const admin = createAdminClient();
      const toHardDelete: typeof attachedResources = [];

      for (const resource of attachedResources) {
        const marker = `[[resource:${resource.id}`;
        const stillReferencedIn = survivingVersions?.find((v) => v.content?.includes(marker));

        if (stillReferencedIn) {
          const { error: reassignError } = await admin
            .from("topic_resources")
            .update({ note_id: stillReferencedIn.id })
            .eq("id", resource.id);
          if (reassignError) throwDbError(reassignError);
        } else {
          toHardDelete.push(resource);
        }
      }

      if (toHardDelete.length > 0) {
        const filePaths = toHardDelete.map((r) => r.file_url).filter((p): p is string => !!p);
        if (filePaths.length) {
          await admin.storage.from(TOPIC_RESOURCE_BUCKET).remove(filePaths);
        }
        const { error: cleanupError } = await admin
          .from("topic_resources")
          .delete()
          .in(
            "id",
            toHardDelete.map((r) => r.id)
          );
        if (cleanupError) throwDbError(cleanupError);
      }
    }

    const { error } = await supabase.from("topic_notes").delete().eq("id", versionNoteId);
    if (error) throwDbError(error);

    revalidatePath(`/dashboard/teacher/notes/${topicId}`);
    revalidatePath("/dashboard/teacher/notes");
  });
}

const MAX_TOPIC_RESOURCE_BYTES = 20 * 1024 * 1024;
const RESOURCE_TYPES = new Map<string, Extract<ResourceType, "image" | "pdf" | "audio" | "video">>([
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["application/pdf", "pdf"],
  ["audio/mpeg", "audio"],
  ["audio/wav", "audio"],
  ["audio/ogg", "audio"],
  ["video/mp4", "video"],
  ["video/webm", "video"],
]);

async function assertTeacherOwnsTopic(
  supabase: ReturnType<typeof createClient>,
  teacherId: string,
  topicId: string
) {
  const [{ data: topic }, { data: teacher }] = await Promise.all([
    supabase.from("curriculum_topics").select("subject_id").eq("id", topicId).single(),
    supabase.from("teacher_profiles").select("subjects_taught").eq("id", teacherId).single(),
  ]);
  if (!topic || !teacher?.subjects_taught?.includes(topic.subject_id)) {
    throw new Error("You can only add resources for subjects assigned to you.");
  }
}

export async function uploadTopicResource(topicId: string, noteId: string, formData: FormData) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can upload resources.");

    const file = formData.get("file");
    const title = String(formData.get("title") ?? "").trim();
    if (!(file instanceof File) || !file.size) throw new Error("Choose a file to upload.");
    if (file.size > MAX_TOPIC_RESOURCE_BYTES)
      throw new Error("Resources must be 20 MB or smaller.");
    const resourceType = RESOURCE_TYPES.get(file.type);
    if (!resourceType)
      throw new Error("Use an image, PDF, MP3/WAV/OGG audio, or MP4/WebM video file.");

    const supabase = createClient();
    await assertTeacherOwnsTopic(supabase, teacherId, topicId);

    const admin = createAdminClient();
    const { error: bucketError } = await admin.storage.createBucket(TOPIC_RESOURCE_BUCKET, {
      public: false,
      fileSizeLimit: `${MAX_TOPIC_RESOURCE_BYTES}`,
      allowedMimeTypes: [...RESOURCE_TYPES.keys()],
    });
    if (bucketError && !/already exists/i.test(bucketError.message)) throwDbError(bucketError);

    const extension =
      file.name
        .split(".")
        .pop()
        ?.replace(/[^a-z0-9]/gi, "") || "file";
    const objectPath = `${topicId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage
      .from(TOPIC_RESOURCE_BUCKET)
      .upload(objectPath, file, {
        contentType: file.type,
      });
    if (uploadError) throwDbError(uploadError);

    const { data: latestResource } = await admin
      .from("topic_resources")
      .select("sequence_order")
      .eq("topic_id", topicId)
      .order("sequence_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: inserted, error: insertError } = await admin
      .from("topic_resources")
      .insert({
        topic_id: topicId,
        note_id: noteId,
        resource_type: resourceType,
        title: title || file.name,
        file_url: objectPath,
        sequence_order: (latestResource?.sequence_order ?? 0) + 1,
        uploaded_by: teacherId,
      })
      .select()
      .single();
    if (insertError) {
      await admin.storage.from(TOPIC_RESOURCE_BUCKET).remove([objectPath]);
      throwDbError(insertError);
    }

    revalidatePath(`/dashboard/teacher/notes/${topicId}`);
    revalidatePath(`/dashboard/student/topics/${topicId}`);

    // `inserted.file_url` is the private bucket's object path, not a
    // fetchable URL -- fine for the DB row, but this return value gets
    // dropped straight into NoteEditor's localResources and rendered
    // immediately (ImageNodeView -> TopicResourceItem -> <img src=...>),
    // so an unsigned path here shows as a broken image the instant the
    // upload finishes. Sign it before handing it back, same as every
    // read path (student topic page, id-card printing) already does.
    const { data: signed } = await admin.storage
      .from(TOPIC_RESOURCE_BUCKET)
      .createSignedUrl(objectPath, 6 * 60 * 60);
    return { ...inserted, file_url: signed?.signedUrl ?? inserted.file_url };
  });
}

// A Mermaid diagram has no binary file to store — its "content" is the
// diagram source itself — so unlike uploadTopicResource this writes
// straight to topic_resources with file_url left null (matching the
// assumption already baked into deleteTopicResource's cleanup logic).
export async function createVideoEmbedResource(
  topicId: string,
  noteId: string,
  url: string,
  title: string
) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can add video embeds.");
    const trimmedUrl = url.trim();
    if (!videoEmbedUrl(trimmedUrl)) throw new Error("Use a valid YouTube or Vimeo HTTPS URL.");
    const supabase = createClient();
    await assertTeacherOwnsTopic(supabase, teacherId, topicId);
    const { data: latest } = await supabase
      .from("topic_resources")
      .select("sequence_order")
      .eq("topic_id", topicId)
      .order("sequence_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabase
      .from("topic_resources")
      .insert({
        topic_id: topicId,
        note_id: noteId,
        resource_type: "link",
        title: title.trim() || "Embedded video",
        content: trimmedUrl,
        sequence_order: (latest?.sequence_order ?? 0) + 1,
        uploaded_by: teacherId,
      })
      .select()
      .single();
    if (error) throwDbError(error);
    revalidatePath(`/dashboard/teacher/notes/${topicId}`);
    revalidatePath(`/dashboard/student/topics/${topicId}`);
    return data;
  });
}

// Unlike createVideoEmbedResource (which only ever needs client-side URL
// pattern matching -- YouTube/Vimeo ids are extractable from the URL
// itself, no fetch required), a generic link preview has to actually
// visit the page to find its og:title/description/image, since there's
// no way to know those from the URL alone. See fetchLinkMetadata for
// why that fetch is SSRF-guarded.
export async function createLinkResource(topicId: string, noteId: string, url: string) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can add links.");
    const supabase = createClient();
    await assertTeacherOwnsTopic(supabase, teacherId, topicId);

    const metadata = await fetchLinkMetadata(url.trim());

    const { data: latest } = await supabase
      .from("topic_resources")
      .select("sequence_order")
      .eq("topic_id", topicId)
      .order("sequence_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabase
      .from("topic_resources")
      .insert({
        topic_id: topicId,
        note_id: noteId,
        resource_type: "link",
        title: metadata.title,
        content: url.trim(),
        file_url: metadata.image,
        description: metadata.description,
        sequence_order: (latest?.sequence_order ?? 0) + 1,
        uploaded_by: teacherId,
      })
      .select()
      .single();
    if (error) throwDbError(error);
    revalidatePath(`/dashboard/teacher/notes/${topicId}`);
    revalidatePath(`/dashboard/student/topics/${topicId}`);
    return data;
  });
}

/**
 * Re-fetches og:title/description/image for an existing `link`
 * resource and overwrites them in place -- for when the auto-fetch at
 * creation time got a stale or wrong preview (a site's og:image
 * changed since, or the page briefly served an error page instead of
 * its real content). Same `resourceId`, so every `[[resource:ID]]`
 * marker pointing at it keeps resolving, no different from
 * `updateMermaidResource`'s "same id, new content" approach.
 */
export async function refreshLinkPreview(resourceId: string) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can edit links.");
    const supabase = createClient();

    const { data: existing } = await supabase
      .from("topic_resources")
      .select("id, topic_id, resource_type, content")
      .eq("id", resourceId)
      .single();

    if (!existing) throw new Error("Resource not found.");
    if (existing.resource_type !== "link") {
      throw new Error("Only link resources can be refreshed this way.");
    }
    if (!existing.content) throw new Error("This link has no URL to refresh from.");

    await assertTeacherOwnsTopic(supabase, teacherId, existing.topic_id);

    const metadata = await fetchLinkMetadata(existing.content);

    const { data: resource, error } = await supabase
      .from("topic_resources")
      .update({
        title: metadata.title,
        description: metadata.description,
        file_url: metadata.image,
      })
      .eq("id", resourceId)
      .select("*")
      .single();

    if (error) throwDbError(error);
    revalidatePath(`/dashboard/teacher/notes/${existing.topic_id}`);
    revalidatePath(`/dashboard/student/topics/${existing.topic_id}`);
    return resource;
  });
}

export async function createMermaidResource(
  topicId: string,
  noteId: string,
  title: string,
  mermaidCode: string
) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can add diagrams.");

    const trimmedCode = mermaidCode.trim();
    if (!trimmedCode) {
      throw new Error("The diagram is empty — write some Mermaid code first.");
    }

    const supabase = createClient();
    await assertTeacherOwnsTopic(supabase, teacherId, topicId);

    const { data: latestResource } = await supabase
      .from("topic_resources")
      .select("sequence_order")
      .eq("topic_id", topicId)
      .order("sequence_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: resource, error } = await supabase
      .from("topic_resources")
      .insert({
        topic_id: topicId,
        note_id: noteId,
        resource_type: "diagram_mermaid",
        title: title.trim() || "Diagram",
        content: trimmedCode,
        file_url: null,
        sequence_order: (latestResource?.sequence_order ?? 0) + 1,
        uploaded_by: teacherId,
      })
      .select("*")
      .single();

    if (error) throwDbError(error);

    revalidatePath(`/dashboard/teacher/notes/${topicId}`);
    revalidatePath(`/dashboard/student/topics/${topicId}`);

    return resource;
  });
}

// Edits an existing diagram in place (same resource id), rather than
// deleting and re-inserting a new one -- any [[resource:ID]] marker
// already pointing at it (in this note or, in principle, another one)
// keeps resolving correctly with no client-side marker-swapping needed.
export async function updateMermaidResource(
  resourceId: string,
  title: string,
  mermaidCode: string
) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can edit diagrams.");

    const trimmedCode = mermaidCode.trim();
    if (!trimmedCode) {
      throw new Error("The diagram is empty — write some Mermaid code first.");
    }

    const supabase = createClient();

    const { data: existing } = await supabase
      .from("topic_resources")
      .select("id, topic_id, resource_type")
      .eq("id", resourceId)
      .single();

    if (!existing) {
      throw new Error("Diagram not found.");
    }
    if (existing.resource_type !== "diagram_mermaid") {
      throw new Error("Only Mermaid diagrams can be edited this way.");
    }

    await assertTeacherOwnsTopic(supabase, teacherId, existing.topic_id);

    const { data: resource, error } = await supabase
      .from("topic_resources")
      .update({
        title: title.trim() || "Diagram",
        content: trimmedCode,
      })
      .eq("id", resourceId)
      .select("*")
      .single();

    if (error) throwDbError(error);

    revalidatePath(`/dashboard/teacher/notes/${existing.topic_id}`);
    revalidatePath(`/dashboard/student/topics/${existing.topic_id}`);

    return resource;
  });
}

// Edits a non-diagram resource in place (same resource id, same
// [[resource:ID]] markers everywhere it's used) -- mirrors
// updateMermaidResource's "update, don't delete+reinsert" approach, just
// for the image/pdf/audio/video/link types that store an actual file
// instead of inline content. `formData` can carry `title` (rename only),
// `file` (replace only), or both in one call.
export async function updateTopicResource(resourceId: string, formData: FormData) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can edit resources.");

    const supabase = createClient();
    const { data: existing } = await supabase
      .from("topic_resources")
      .select("id, topic_id, resource_type, file_url")
      .eq("id", resourceId)
      .single();

    if (!existing) throw new Error("Resource not found.");
    if (existing.resource_type === "diagram_mermaid") {
      throw new Error("Diagrams are edited via updateMermaidResource, not this action.");
    }

    await assertTeacherOwnsTopic(supabase, teacherId, existing.topic_id);

    const titleRaw = formData.get("title");
    const title = typeof titleRaw === "string" ? titleRaw.trim() : undefined;
    const file = formData.get("file");

    const update: Record<string, unknown> = {};
    if (title !== undefined) update.title = title || null;

    const admin = createAdminClient();
    let newObjectPath: string | null = null;

    if (file instanceof File && file.size) {
      if (file.size > MAX_TOPIC_RESOURCE_BYTES)
        throw new Error("Resources must be 20 MB or smaller.");
      const resourceType = RESOURCE_TYPES.get(file.type);
      if (!resourceType)
        throw new Error("Use an image, PDF, MP3/WAV/OGG audio, or MP4/WebM video file.");

      const extension =
        file.name
          .split(".")
          .pop()
          ?.replace(/[^a-z0-9]/gi, "") || "file";
      newObjectPath = `${existing.topic_id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await admin.storage
        .from(TOPIC_RESOURCE_BUCKET)
        .upload(newObjectPath, file, { contentType: file.type });
      if (uploadError) throwDbError(uploadError);

      update.resource_type = resourceType;
      update.file_url = newObjectPath;
    }

    if (Object.keys(update).length === 0) {
      throw new Error("Nothing to update — give a new title or file.");
    }

    const { data: resource, error } = await supabase
      .from("topic_resources")
      // Supabase's generated update() typing wants an object literal that
      // matches TopicResource's shape exactly, not a dynamically-built
      // Record<string, unknown> -- this is genuinely a partial update whose
      // keys depend on which of title/file were passed in, so the cast is
      // accurate rather than papering over a real type mismatch.
      .update(update as any)
      .eq("id", resourceId)
      .select("*")
      .single();

    if (error) {
      // Roll back the just-uploaded replacement file if the row update
      // failed, same cleanup-on-failure pattern uploadTopicResource uses.
      if (newObjectPath) await admin.storage.from(TOPIC_RESOURCE_BUCKET).remove([newObjectPath]);
      throwDbError(error);
    }

    // Only remove the *old* file after the row update succeeds and points
    // at the new one -- removing it earlier would leave a broken resource
    // if the update itself failed.
    if (newObjectPath && existing.file_url) {
      await admin.storage.from(TOPIC_RESOURCE_BUCKET).remove([existing.file_url]);
    }

    revalidatePath(`/dashboard/teacher/notes/${existing.topic_id}`);
    revalidatePath(`/dashboard/student/topics/${existing.topic_id}`);

    // Same reasoning as uploadTopicResource's return: this goes straight
    // back into the client's live resource list and re-renders the node
    // view immediately, so a replaced file needs a fetchable URL, not the
    // raw private-bucket object path.
    if (newObjectPath) {
      const { data: signed } = await admin.storage
        .from(TOPIC_RESOURCE_BUCKET)
        .createSignedUrl(newObjectPath, 6 * 60 * 60);
      return { ...resource, file_url: signed?.signedUrl ?? resource.file_url };
    }

    return resource;
  });
}

export async function deleteTopicResource(resourceId: string) {
  return runAction(async () => {
    const { id: teacherId } = await assertRole(["teacher"], "Only teachers can remove resources.");

    const supabase = createClient();

    const { data: resource } = await supabase
      .from("topic_resources")
      .select("id, file_url, topic_id")
      .eq("id", resourceId)
      .single();

    if (!resource) {
      throw new Error("Resource not found.");
    }

    await assertTeacherOwnsTopic(supabase, teacherId, resource.topic_id);

    const admin = createAdminClient();

    // diagram_mermaid resources store their content inline (file_url is
    // null) — only image/pdf/audio/video have an actual storage object to
    // clean up.
    if (resource.file_url) {
      await admin.storage.from(TOPIC_RESOURCE_BUCKET).remove([resource.file_url]);
    }

    const { error: deleteError } = await admin
      .from("topic_resources")
      .delete()
      .eq("id", resourceId);

    if (deleteError) throwDbError(deleteError);

    revalidatePath(`/dashboard/teacher/notes/${resource.topic_id}`);
    revalidatePath(`/dashboard/student/topics/${resource.topic_id}`);
  });
}
