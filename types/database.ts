// These types are maintained by hand and must be kept aligned with the
// actual SQL schema in supabase/migrations/. There is no automated check
// (CI drift check) enforcing this yet -- see "Notes for contributors" in
// README.md. After any migration that adds/changes a table or column,
// regenerate and diff against this file: run
// `supabase gen types typescript --linked` and compare its output here
// by hand before committing.
export type UserRole = "student" | "teacher" | "admin" | "parent";
export type NoteStatus = "draft" | "published" | "archived";
export type NoteModerationStatus = "pending" | "approved" | "rejected";
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type StudentNoteType = "behavioral" | "academic" | "commendation" | "disciplinary";
export type AnnouncementAudience = "all" | "students" | "teachers" | "class";
export type HomeworkStatus = "given" | "reviewed" | "graded";
export type HomeworkSubmissionStatus = "submitted" | "reviewed";
export type AssessmentType =
  | "first_ca"
  | "second_ca"
  | "exam"
  | "test"
  | "assignment"
  | "project"
  | "practical"
  | "quiz"
  | "other";
export type InvoiceStatus = "unpaid" | "partial" | "paid";
export type PaymentMethod = "cash" | "bank_transfer" | "card" | "other";
export type StaffRole =
  "teacher" | "hod" | "bursar" | "librarian" | "house_parent" | "transport_officer" | "driver";
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  teacher: "Teacher",
  hod: "Academic Head",
  bursar: "Bursar",
  librarian: "Librarian",
  house_parent: "House parent",
  transport_officer: "Transport officer",
  driver: "Driver",
};
export type GradeModerationStatus = "pending" | "approved" | "rejected";
export type ResourceType = "image" | "diagram_mermaid" | "video" | "pdf" | "link" | "audio";
export type AssetCondition = "new" | "good" | "fair" | "poor" | "damaged";

export const ASSET_CONDITIONS: AssetCondition[] = ["new", "good", "fair", "poor", "damaged"];

export type EducationLevel = "primary" | "jss" | "sss";

export function formatLevel(level: EducationLevel, levelNumber: number): string {
  if (level === "primary") return `Primary ${levelNumber}`;
  if (level === "jss") return `JSS ${levelNumber}`;
  return `SS ${levelNumber}`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatKobo(kobo: number | bigint | string): string {
  const zero = BigInt(0);
  const hundred = BigInt(100);
  const kb = typeof kobo === "bigint" ? kobo : BigInt(Math.trunc(Number(kobo)));
  const negative = kb < zero;
  const abs = negative ? -kb : kb;
  const wholeNaira = abs / hundred;
  const koboRemainder = abs % hundred;
  const naira = groupThousands(wholeNaira.toString());
  const decimals = koboRemainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}₦${naira}.${decimals}`;
}

export type Profile = {
  id: string;
  role: UserRole;
  full_name: string;
  avatar_url: string | null;
  must_change_password: boolean;
  is_active: boolean;
  created_at: string;
};

export type ProfileContact = {
  id: string;
  email: string;
  phone: string | null;
};

export type StudentProfile = {
  id: string;
  admission_no: string | null;
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  class_id: string | null;
  gender: "male" | "female" | null;
};

export type TeacherProfile = {
  id: string;
  staff_id: string | null;
  subjects_taught: string[] | null;
  hire_date: string | null;
  staff_role: StaffRole;
};

export type GuardianLink = {
  id: string;
  parent_id: string;
  student_id: string;
  relationship: string | null;
  is_primary: boolean;
  created_at: string;
};

export type ClassRow = {
  id: string;
  name: string;
  arm: string | null;
  education_level: EducationLevel;
  level_number: number;
  class_teacher_id: string | null;
  academic_year: string;
  is_archived: boolean;
  created_at: string;
};

export type Enrollment = {
  id: string;
  student_id: string;
  class_id: string;
  academic_year: string;
  term: number;
  enrolled_at: string;
};

export type Subject = {
  id: string;
  name: string;
  code: string | null;
  education_level: EducationLevel;
  min_level_number: number;
  max_level_number: number;
  description: string | null;
};

export type CurriculumTopic = {
  id: string;
  subject_id: string;
  education_level: EducationLevel;
  level_number: number;
  term: number;
  academic_year: string;
  title: string;
  description: string | null;
  sequence_order: number;
  week_number: number;
  week_end_number: number;
  theme: string | null;
  created_by: string | null;
  created_at: string;
};

export type TopicNote = {
  id: string;
  topic_id: string;
  author_id: string | null;
  content: string;
  status: NoteStatus;
  moderation_status: NoteModerationStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

export type TopicNoteDraft = {
  topic_id: string;
  author_id: string;
  content: string;
  updated_at: string;
};

export type TopicResource = {
  id: string;
  topic_id: string;
  note_id: string | null;
  resource_type: ResourceType;
  title: string | null;
  content: string | null;
  file_url: string | null;
  description: string | null;
  sequence_order: number;
  uploaded_by: string | null;
  created_at: string;
};

export type TimetableEntry = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  weekday: number;
  period_number: number;
  start_time: string;
  end_time: string;
  room: string | null;
  academic_year: string;
  term: number;
};

export type BellPeriod = {
  id: string;
  /** null for breaks; the same number timetable_entries.period_number uses for lessons. */
  period_number: number | null;
  label: string;
  is_break: boolean;
  /** "HH:MM:SS" wall-clock time (plain `time` column, no date or timezone). */
  start_time: string;
  end_time: string;
  created_at: string;
};

export type Lesson = {
  id: string;
  timetable_entry_id: string | null;
  topic_id: string | null;
  class_id: string;
  teacher_id: string;
  lesson_date: string;
  objectives: string | null;
  homework: string | null;
  homework_status: HomeworkStatus;
  homework_due_at: string | null;
  created_at: string;
};

// Mirrors isLoanOverdue's local-midnight comparison below, applied to
// homework instead of library loans: "overdue" only means something once
// there's a due date and it isn't graded/reviewed yet.
export type HomeworkDueStatus = "none" | "overdue" | "due_today" | "due_soon" | "upcoming";

export function homeworkDueStatus(
  lesson: Pick<Lesson, "homework_due_at" | "homework_status">
): HomeworkDueStatus {
  if (!lesson.homework_due_at) return "none";
  if (lesson.homework_status === "reviewed" || lesson.homework_status === "graded") return "none";

  const [year, month, day] = lesson.homework_due_at.split("-").map(Number);
  const dueAtLocalMidnight = new Date(year, month - 1, day);
  const now = new Date();
  const todayLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (dueAtLocalMidnight.getTime() - todayLocalMidnight.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "due_today";
  if (diffDays <= 2) return "due_soon";
  return "upcoming";
}

/**
 * What a student (or their parent) should see on a homework card.
 * `lesson.homework_status` is a class-wide status the teacher sets by hand;
 * a single student's submission has its own status (submitted -> reviewed).
 * Without folding the submission in, a student whose work had been reviewed
 * kept seeing "Given" until the teacher also flipped the whole lesson.
 */
export type HomeworkDisplayStatus = "given" | "submitted" | "reviewed" | "graded";

export function homeworkDisplayStatus(
  lessonStatus: HomeworkStatus,
  submissionStatus?: HomeworkSubmissionStatus | null
): HomeworkDisplayStatus {
  if (lessonStatus === "graded") return "graded";
  if (submissionStatus === "reviewed" || lessonStatus === "reviewed") return "reviewed";
  if (submissionStatus === "submitted") return "submitted";
  return "given";
}

export type Attendance = {
  id: string;
  class_id: string;
  student_id: string;
  date: string;
  status: AttendanceStatus;
  marked_by: string | null;
  marked_at: string;
};

export type HomeworkSubmission = {
  id: string;
  lesson_id: string;
  student_id: string;
  file_url: string;
  file_name: string | null;
  submitted_at: string;
  teacher_remark: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  status: HomeworkSubmissionStatus;
  grade_seen_at: string | null;
};

export type Assessment = {
  id: string;
  subject_id: string;
  class_id: string;
  title: string;
  assessment_type: AssessmentType;
  max_score: number;
  weight_percent: number | null;
  term: number;
  academic_year: string;
  created_by: string | null;
};

export type Grade = {
  id: string;
  assessment_id: string;
  student_id: string;
  score: number;
  remark: string | null;
  graded_by: string | null;
  graded_at: string;
  moderation_status: GradeModerationStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export type StudentNote = {
  id: string;
  student_id: string;
  author_id: string | null;
  note_type: StudentNoteType;
  content: string;
  visible_to_student: boolean;
  created_at: string;
};

export type Announcement = {
  id: string;
  author_id: string | null;
  title: string;
  content: string;
  audience: AnnouncementAudience;
  class_id: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  read: boolean;
  sent_at: string;
};

export type ConversationArchive = {
  user_id: string;
  partner_id: string;
  archived_at: string;
};

export type ReportCardRemark = {
  id: string;
  student_id: string;
  term: number;
  academic_year: string;
  class_teacher_remark: string | null;
  admin_remark: string | null;
  updated_by: string | null;
  updated_at: string;
  moderation_status: "pending" | "approved";
  approved_by: string | null;
  approved_at: string | null;
};

export type GradeScaleEntry = { grade: string; min: number };

export type SchoolSettings = {
  id: number;
  name: string;
  logo_url: string | null;
  motto: string | null;
  address: string | null;
  current_academic_year: string;
  current_term: number;
  current_term_start_date: string | null;
  library_fine_kobo_per_day: number;
  student_online_payment_enabled: boolean;
  grade_scale: GradeScaleEntry[];
  updated_at: string;
};

export function scoreToLetterGrade(percent: number, scale: GradeScaleEntry[]): string {
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  for (const entry of sorted) {
    if (percent >= entry.min) return entry.grade;
  }
  return sorted[sorted.length - 1]?.grade ?? "—";
}

export type FeeStructure = {
  id: string;
  education_level: EducationLevel;
  level_number: number;
  term: number;
  academic_year: string;
  title: string;
  amount_kobo: number;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
};

export type Invoice = {
  id: string;
  student_id: string;
  fee_structure_id: string | null;
  transport_fee_structure_id: string | null;
  hostel_fee_structure_id: string | null;
  term: number;
  academic_year: string;
  total_amount_kobo: number;
  discount_kobo: number;
  amount_paid_kobo: number;
  status: InvoiceStatus;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  last_reminded_at: string | null;
};

export type InvoiceInstallment = {
  id: string;
  invoice_id: string;
  sequence_order: number;
  due_date: string;
  amount_kobo: number;
  created_by: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  invoice_id: string;
  student_id: string;
  amount_kobo: number;
  method: PaymentMethod;
  reference: string | null;
  verified_by: string | null;
  paid_at: string;
};

export type AuditLogEntry = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type LibraryBook = {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string | null;
  total_copies: number;
  available_copies: number;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
};

export type LibraryLoan = {
  id: string;
  book_id: string;
  student_id: string;
  borrowed_at: string;
  due_at: string;
  returned_at: string | null;
  issued_by: string | null;
  returned_to: string | null;
  created_at: string;
};

export function isLoanOverdue(loan: Pick<LibraryLoan, "due_at" | "returned_at">): boolean {
  if (loan.returned_at) return false;
  const [year, month, day] = loan.due_at.split("-").map(Number);
  const dueAtLocalMidnight = new Date(year, month - 1, day);
  const now = new Date();
  const todayLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dueAtLocalMidnight < todayLocalMidnight;
}

export type Asset = {
  id: string;
  name: string;
  category: string | null;
  serial_no: string | null;
  condition: AssetCondition;
  location: string | null;
  assigned_to: string | null;
  notes: string | null;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Hostel = {
  id: string;
  name: string;
  gender: "male" | "female";
  house_parent_id: string | null;
  capacity: number | null;
  created_at: string;
};

export type HostelRoom = {
  id: string;
  hostel_id: string;
  room_number: string;
  capacity: number;
  created_at: string;
};

export type HostelAssignment = {
  id: string;
  student_id: string;
  room_id: string;
  academic_year: string;
  assigned_at: string;
  unassigned_at: string | null;
  assigned_by: string | null;
};

export type HostelLeaveLog = {
  id: string;
  student_id: string;
  reason: string | null;
  out_at: string;
  expected_return_at: string | null;
  returned_at: string | null;
  logged_by: string | null;
  returned_logged_by: string | null;
  created_at: string;
};

export function isOnLeave(log: HostelLeaveLog): boolean {
  return log.returned_at === null;
}

export type HostelVisitorLog = {
  id: string;
  student_id: string;
  visitor_name: string;
  visitor_phone: string | null;
  relationship: string | null;
  purpose: string | null;
  checked_in_at: string;
  checked_out_at: string | null;
  logged_by: string | null;
  checked_out_logged_by: string | null;
  created_at: string;
};

export function isVisitorCheckedIn(log: HostelVisitorLog): boolean {
  return log.checked_out_at === null;
}

export type Testimonial = {
  id: string;
  student_id: string;
  conduct_remark: string;
  admission_academic_year: string;
  leaving_academic_year: string;
  issued_by: string | null;
  issued_at: string;
};

export type Vehicle = {
  id: string;
  plate_number: string;
  model: string | null;
  capacity: number;
  driver_name: string | null;
  driver_phone: string | null;
  driver_profile_id: string | null;
  is_archived: boolean;
  created_at: string;
};

export type TransportRoute = {
  id: string;
  name: string;
  description: string | null;
  vehicle_id: string | null;
  is_archived: boolean;
  created_at: string;
};

export type TransportStop = {
  id: string;
  route_id: string;
  name: string;
  sequence_order: number;
  approx_time: string | null;
  created_at: string;
};

export type TransportAssignment = {
  id: string;
  student_id: string;
  route_id: string;
  stop_id: string;
  academic_year: string;
  assigned_at: string;
  unassigned_at: string | null;
  assigned_by: string | null;
};

export type TripDirection = "morning" | "afternoon";
export type TripStatusValue = "not_started" | "en_route" | "arrived";

export type TransportPickupLog = {
  id: string;
  student_id: string;
  route_id: string;
  trip_date: string;
  direction: TripDirection;
  picked_up_at: string | null;
  dropped_off_at: string | null;
  marked_by: string | null;
  updated_at: string;
};

export type TransportTripStatus = {
  id: string;
  route_id: string;
  trip_date: string;
  direction: TripDirection;
  status: TripStatusValue;
  updated_by: string | null;
  updated_at: string;
};

export const TRIP_STATUS_LABELS: Record<TripStatusValue, string> = {
  not_started: "Not started",
  en_route: "En route",
  arrived: "Arrived",
};

export type TransportLocation = {
  id: string;
  route_id: string;
  trip_date: string;
  direction: TripDirection;
  lat: number;
  lng: number;
  recorded_at: string;
  recorded_by: string | null;
};

export type RouteVehicleHistory = {
  id: string;
  route_id: string;
  vehicle_id: string;
  assigned_at: string;
  unassigned_at: string | null;
  assigned_by: string | null;
};

// --- Quiz / assessment types ---

export type QuestionType = "mcq" | "true_false" | "fill_blank" | "matching" | "essay";

export type Quiz = {
  id: string;
  assessment_id: string;
  duration_minutes: number;
  opens_at: string | null;
  closes_at: string | null;
  is_published: boolean;
  shuffle_questions: boolean;
  created_at: string;
};

export type QuizQuestion = {
  id: string;
  quiz_id: string;
  question_text: string;
  question_type: QuestionType;
  points: number;
  sequence_order: number;
  created_at: string;
};

export type QuizOption = {
  id: string;
  question_id: string;
  option_text: string;
  match_prompt: string | null;
  is_correct: boolean;
  sequence_order: number;
};

export type QuizAttempt = {
  id: string;
  quiz_id: string;
  student_id: string;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  total_points: number | null;
  grade_id: string | null;
};

export type QuizAnswer = {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_option_id: string | null;
  answer_text: string | null;
  matched_pairs: Record<string, string> | null;
  points_awarded: number | null;
  answered_at: string;
};

// One row of get_quiz_attempt_questions. For matching questions the RPC
// returns two kinds of rows: left rows (option_id + match_prompt, option_text
// null) and pool rows (option_id null, option_text only). No row ever has
// both a match_prompt and its correct option_text. fill_blank and essay
// questions come back as a single row with every option column null.
// (get_quiz_attempt_review extends this type and is only available once the
// attempt is submitted, so it does carry the answers.)
export type QuizAttemptQuestionRow = {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  points: number;
  question_sequence: number;
  option_id: string | null;
  option_text: string | null;
  match_prompt: string | null;
  option_sequence: number | null;
  selected_option_id: string | null;
  answer_text: string | null;
  matched_pairs: Record<string, string> | null;
};

export type QuizAttemptReviewRow = QuizAttemptQuestionRow & {
  is_correct: boolean | null;
  points_awarded: number | null;
};

export type TopicNoteSearchResult = {
  note_id: string;
  topic_id: string;
  topic_title: string | null;
  subject_name: string | null;
  snippet: string;
  rank: number;
};

export type TransportFeeStructure = {
  id: string;
  route_id: string;
  term: number;
  academic_year: string;
  title: string;
  amount_kobo: number;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
};

export type HostelFeeStructure = {
  id: string;
  hostel_id: string;
  term: number;
  academic_year: string;
  title: string;
  amount_kobo: number;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
};

export type HostelWaitlistEntry = {
  id: string;
  student_id: string;
  hostel_id: string;
  requested_at: string;
  requested_by: string | null;
  fulfilled_at: string | null;
  fulfilled_room_id: string | null;
  cancelled_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile>;
        Update: Partial<Profile>;
        Relationships: [];
      };
      profile_contacts: {
        Row: ProfileContact;
        Insert: Partial<ProfileContact>;
        Update: Partial<ProfileContact>;
        Relationships: [
          {
            foreignKeyName: "profile_contacts_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      student_profiles: {
        Row: StudentProfile;
        Insert: Partial<StudentProfile>;
        Update: Partial<StudentProfile>;
        Relationships: [
          {
            foreignKeyName: "student_profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_student_class";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_profiles: {
        Row: TeacherProfile;
        Insert: Partial<TeacherProfile>;
        Update: Partial<TeacherProfile>;
        Relationships: [
          {
            foreignKeyName: "teacher_profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      guardian_links: {
        Row: GuardianLink;
        Insert: Partial<GuardianLink>;
        Update: Partial<GuardianLink>;
        Relationships: [
          {
            foreignKeyName: "guardian_links_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guardian_links_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      classes: {
        Row: ClassRow;
        Insert: Partial<ClassRow>;
        Update: Partial<ClassRow>;
        Relationships: [
          {
            foreignKeyName: "classes_class_teacher_id_fkey";
            columns: ["class_teacher_id"];
            isOneToOne: false;
            referencedRelation: "teacher_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      enrollments: {
        Row: Enrollment;
        Insert: Partial<Enrollment>;
        Update: Partial<Enrollment>;
        Relationships: [
          {
            foreignKeyName: "enrollments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollments_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
        ];
      };
      subjects: {
        Row: Subject;
        Insert: Partial<Subject>;
        Update: Partial<Subject>;
        Relationships: [];
      };
      curriculum_topics: {
        Row: CurriculumTopic;
        Insert: Partial<CurriculumTopic>;
        Update: Partial<CurriculumTopic>;
        Relationships: [
          {
            foreignKeyName: "curriculum_topics_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "curriculum_topics_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      topic_note_drafts: {
        Row: TopicNoteDraft;
        Insert: Partial<TopicNoteDraft>;
        Update: Partial<TopicNoteDraft>;
        Relationships: [
          {
            foreignKeyName: "topic_note_drafts_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "curriculum_topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topic_note_drafts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      topic_notes: {
        Row: TopicNote;
        Insert: Partial<TopicNote>;
        Update: Partial<TopicNote>;
        Relationships: [
          {
            foreignKeyName: "topic_notes_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "curriculum_topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topic_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      topic_resources: {
        Row: TopicResource;
        Insert: Partial<TopicResource>;
        Update: Partial<TopicResource>;
        Relationships: [
          {
            foreignKeyName: "topic_resources_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "curriculum_topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topic_resources_note_id_fkey";
            columns: ["note_id"];
            isOneToOne: false;
            referencedRelation: "topic_notes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topic_resources_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      timetable_entries: {
        Row: TimetableEntry;
        Insert: Partial<TimetableEntry>;
        Update: Partial<TimetableEntry>;
        Relationships: [
          {
            foreignKeyName: "timetable_entries_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timetable_entries_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timetable_entries_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "teacher_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      lessons: {
        Row: Lesson;
        Insert: Partial<Lesson>;
        Update: Partial<Lesson>;
        Relationships: [
          {
            foreignKeyName: "lessons_timetable_entry_id_fkey";
            columns: ["timetable_entry_id"];
            isOneToOne: false;
            referencedRelation: "timetable_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "curriculum_topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "teacher_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance: {
        Row: Attendance;
        Insert: Partial<Attendance>;
        Update: Partial<Attendance>;
        Relationships: [
          {
            foreignKeyName: "attendance_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_marked_by_fkey";
            columns: ["marked_by"];
            isOneToOne: false;
            referencedRelation: "teacher_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      homework_submissions: {
        Row: HomeworkSubmission;
        Insert: Partial<HomeworkSubmission>;
        Update: Partial<HomeworkSubmission>;
        Relationships: [
          {
            foreignKeyName: "homework_submissions_lesson_id_fkey";
            columns: ["lesson_id"];
            isOneToOne: false;
            referencedRelation: "lessons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "homework_submissions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "homework_submissions_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "teacher_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      assets: {
        Row: Asset;
        Insert: Partial<Asset>;
        Update: Partial<Asset>;
        Relationships: [
          {
            foreignKeyName: "assets_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      assessments: {
        Row: Assessment;
        Insert: Partial<Assessment>;
        Update: Partial<Assessment>;
        Relationships: [
          {
            foreignKeyName: "assessments_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assessments_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assessments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "teacher_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      grades: {
        Row: Grade;
        Insert: Partial<Grade>;
        Update: Partial<Grade>;
        Relationships: [
          {
            foreignKeyName: "grades_assessment_id_fkey";
            columns: ["assessment_id"];
            isOneToOne: false;
            referencedRelation: "assessments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "grades_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "grades_graded_by_fkey";
            columns: ["graded_by"];
            isOneToOne: false;
            referencedRelation: "teacher_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      student_notes: {
        Row: StudentNote;
        Insert: Partial<StudentNote>;
        Update: Partial<StudentNote>;
        Relationships: [
          {
            foreignKeyName: "student_notes_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      announcements: {
        Row: Announcement;
        Insert: Partial<Announcement>;
        Update: Partial<Announcement>;
        Relationships: [
          {
            foreignKeyName: "announcements_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcements_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
        ];
      };
      bell_periods: {
        Row: BellPeriod;
        Insert: Partial<BellPeriod>;
        Update: Partial<BellPeriod>;
        Relationships: [];
      };
      messages: {
        Row: Message;
        Insert: Partial<Message>;
        Update: Partial<Message>;
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_archives: {
        Row: ConversationArchive;
        Insert: Partial<ConversationArchive>;
        Update: Partial<ConversationArchive>;
        Relationships: [
          {
            foreignKeyName: "conversation_archives_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_archives_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      report_card_remarks: {
        Row: ReportCardRemark;
        Insert: Partial<ReportCardRemark>;
        Update: Partial<ReportCardRemark>;
        Relationships: [
          {
            foreignKeyName: "report_card_remarks_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_card_remarks_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_card_remarks_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      school_settings: {
        Row: SchoolSettings;
        Insert: Partial<SchoolSettings>;
        Update: Partial<SchoolSettings>;
        Relationships: [];
      };
      fee_structures: {
        Row: FeeStructure;
        Insert: Partial<FeeStructure>;
        Update: Partial<FeeStructure>;
        Relationships: [
          {
            foreignKeyName: "fee_structures_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_fee_structures: {
        Row: TransportFeeStructure;
        Insert: Partial<TransportFeeStructure>;
        Update: Partial<TransportFeeStructure>;
        Relationships: [
          {
            foreignKeyName: "transport_fee_structures_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "transport_routes";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_fee_structures: {
        Row: HostelFeeStructure;
        Insert: Partial<HostelFeeStructure>;
        Update: Partial<HostelFeeStructure>;
        Relationships: [
          {
            foreignKeyName: "hostel_fee_structures_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_waitlist: {
        Row: HostelWaitlistEntry;
        Insert: Partial<HostelWaitlistEntry>;
        Update: Partial<HostelWaitlistEntry>;
        Relationships: [
          {
            foreignKeyName: "hostel_waitlist_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_waitlist_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: Invoice;
        Insert: Partial<Invoice>;
        Update: Partial<Invoice>;
        Relationships: [
          {
            foreignKeyName: "invoices_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_fee_structure_id_fkey";
            columns: ["fee_structure_id"];
            isOneToOne: false;
            referencedRelation: "fee_structures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_transport_fee_structure_id_fkey";
            columns: ["transport_fee_structure_id"];
            isOneToOne: false;
            referencedRelation: "transport_fee_structures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_hostel_fee_structure_id_fkey";
            columns: ["hostel_fee_structure_id"];
            isOneToOne: false;
            referencedRelation: "hostel_fee_structures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_installments: {
        Row: InvoiceInstallment;
        Insert: Partial<InvoiceInstallment>;
        Update: Partial<InvoiceInstallment>;
        Relationships: [
          {
            foreignKeyName: "invoice_installments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: Payment;
        Insert: Partial<Payment>;
        Update: Partial<Payment>;
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_verified_by_fkey";
            columns: ["verified_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: AuditLogEntry;
        Insert: Partial<AuditLogEntry>;
        Update: Partial<AuditLogEntry>;
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      library_books: {
        Row: LibraryBook;
        Insert: Partial<LibraryBook>;
        Update: Partial<LibraryBook>;
        Relationships: [
          {
            foreignKeyName: "library_books_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      library_loans: {
        Row: LibraryLoan;
        Insert: Partial<LibraryLoan>;
        Update: Partial<LibraryLoan>;
        Relationships: [
          {
            foreignKeyName: "library_loans_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "library_books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "library_loans_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "library_loans_issued_by_fkey";
            columns: ["issued_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "library_loans_returned_to_fkey";
            columns: ["returned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      hostels: {
        Row: Hostel;
        Insert: Partial<Hostel>;
        Update: Partial<Hostel>;
        Relationships: [
          {
            foreignKeyName: "hostels_house_parent_id_fkey";
            columns: ["house_parent_id"];
            isOneToOne: false;
            referencedRelation: "teacher_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_rooms: {
        Row: HostelRoom;
        Insert: Partial<HostelRoom>;
        Update: Partial<HostelRoom>;
        Relationships: [
          {
            foreignKeyName: "hostel_rooms_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_assignments: {
        Row: HostelAssignment;
        Insert: Partial<HostelAssignment>;
        Update: Partial<HostelAssignment>;
        Relationships: [
          {
            foreignKeyName: "hostel_assignments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_assignments_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "hostel_rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_leave_logs: {
        Row: HostelLeaveLog;
        Insert: Partial<HostelLeaveLog>;
        Update: Partial<HostelLeaveLog>;
        Relationships: [
          {
            foreignKeyName: "hostel_leave_logs_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_leave_logs_logged_by_fkey";
            columns: ["logged_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_leave_logs_returned_logged_by_fkey";
            columns: ["returned_logged_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_visitor_logs: {
        Row: HostelVisitorLog;
        Insert: Partial<HostelVisitorLog>;
        Update: Partial<HostelVisitorLog>;
        Relationships: [
          {
            foreignKeyName: "hostel_visitor_logs_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_visitor_logs_logged_by_fkey";
            columns: ["logged_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_visitor_logs_checked_out_logged_by_fkey";
            columns: ["checked_out_logged_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      testimonials: {
        Row: Testimonial;
        Insert: Partial<Testimonial>;
        Update: Partial<Testimonial>;
        Relationships: [
          {
            foreignKeyName: "testimonials_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "testimonials_issued_by_fkey";
            columns: ["issued_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: Vehicle;
        Insert: Partial<Vehicle>;
        Update: Partial<Vehicle>;
        Relationships: [
          {
            foreignKeyName: "vehicles_driver_profile_id_fkey";
            columns: ["driver_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_routes: {
        Row: TransportRoute;
        Insert: Partial<TransportRoute>;
        Update: Partial<TransportRoute>;
        Relationships: [
          {
            foreignKeyName: "transport_routes_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_stops: {
        Row: TransportStop;
        Insert: Partial<TransportStop>;
        Update: Partial<TransportStop>;
        Relationships: [
          {
            foreignKeyName: "transport_stops_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "transport_routes";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_assignments: {
        Row: TransportAssignment;
        Insert: Partial<TransportAssignment>;
        Update: Partial<TransportAssignment>;
        Relationships: [
          {
            foreignKeyName: "transport_assignments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_assignments_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "transport_routes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_assignments_stop_id_fkey";
            columns: ["stop_id"];
            isOneToOne: false;
            referencedRelation: "transport_stops";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_trip_status: {
        Row: TransportTripStatus;
        Insert: Partial<TransportTripStatus>;
        Update: Partial<TransportTripStatus>;
        Relationships: [
          {
            foreignKeyName: "transport_trip_status_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "transport_routes";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_pickup_logs: {
        Row: TransportPickupLog;
        Insert: Partial<TransportPickupLog>;
        Update: Partial<TransportPickupLog>;
        Relationships: [
          {
            foreignKeyName: "transport_pickup_logs_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_pickup_logs_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "transport_routes";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_locations: {
        Row: TransportLocation;
        Insert: Partial<TransportLocation>;
        Update: Partial<TransportLocation>;
        Relationships: [
          {
            foreignKeyName: "transport_locations_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "transport_routes";
            referencedColumns: ["id"];
          },
        ];
      };
      route_vehicle_history: {
        Row: RouteVehicleHistory;
        Insert: Partial<RouteVehicleHistory>;
        Update: Partial<RouteVehicleHistory>;
        Relationships: [
          {
            foreignKeyName: "route_vehicle_history_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "transport_routes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_vehicle_history_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      quizzes: {
        Row: Quiz;
        Insert: Partial<Quiz>;
        Update: Partial<Quiz>;
        Relationships: [
          {
            foreignKeyName: "quizzes_assessment_id_fkey";
            columns: ["assessment_id"];
            isOneToOne: true;
            referencedRelation: "assessments";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_questions: {
        Row: QuizQuestion;
        Insert: Partial<QuizQuestion>;
        Update: Partial<QuizQuestion>;
        Relationships: [
          {
            foreignKeyName: "quiz_questions_quiz_id_fkey";
            columns: ["quiz_id"];
            isOneToOne: false;
            referencedRelation: "quizzes";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_options: {
        Row: QuizOption;
        Insert: Partial<QuizOption>;
        Update: Partial<QuizOption>;
        Relationships: [
          {
            foreignKeyName: "quiz_options_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "quiz_questions";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_attempts: {
        Row: QuizAttempt;
        Insert: Partial<QuizAttempt>;
        Update: Partial<QuizAttempt>;
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey";
            columns: ["quiz_id"];
            isOneToOne: false;
            referencedRelation: "quizzes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quiz_attempts_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quiz_attempts_grade_id_fkey";
            columns: ["grade_id"];
            isOneToOne: false;
            referencedRelation: "grades";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_answers: {
        Row: QuizAnswer;
        Insert: Partial<QuizAnswer>;
        Update: Partial<QuizAnswer>;
        Relationships: [
          {
            foreignKeyName: "quiz_answers_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "quiz_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quiz_answers_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "quiz_questions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      borrow_library_book: {
        Args: { p_book_id: string; p_student_id: string; p_due_at: string };
        Returns: LibraryLoan;
      };
      return_library_book: {
        Args: { p_loan_id: string };
        Returns: (LibraryLoan & { overdue_days: number; fine_kobo: number })[];
      };
      current_scheme_week: {
        Args: Record<string, never>;
        Returns: number | null;
      };
      admin_overview_counts: {
        Args: Record<string, never>;
        Returns: {
          student_count: number;
          teacher_count: number;
          class_count: number;
          subject_count: number;
        }[];
      };
      get_notification_counts: {
        Args: Record<string, never>;
        Returns: {
          unread_messages: number;
          unread_announcements: number;
          unread_graded_homework: number;
        }[];
      };
      mark_all_announcements_read: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      mark_all_homework_seen: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      invoice_dashboard_totals: {
        Args: { p_academic_year?: string | null; p_term?: number | null };
        Returns: {
          total_billed: number;
          total_collected: number;
          total_outstanding: number;
          unpaid_invoice_count: number;
        }[];
      };
      student_current_hostel: {
        Args: { sid: string };
        Returns: string | null;
      };
      assign_student_to_hostel_room: {
        Args: { p_student_id: string; p_room_id: string; p_academic_year: string };
        Returns: HostelAssignment;
      };
      assign_student_to_route: {
        Args: {
          p_student_id: string;
          p_route_id: string;
          p_stop_id: string;
          p_academic_year: string;
        };
        Returns: TransportAssignment;
      };
      join_hostel_waitlist: {
        Args: { p_student_id: string; p_hostel_id: string };
        Returns: HostelWaitlistEntry;
      };
      record_invoice_payment: {
        Args: {
          p_amount_kobo: number;
          p_enforce_balance: boolean;
          p_invoice_id: string;
          p_method: PaymentMethod;
          p_reference: string | null;
          p_verified_by: string | null;
        };
        Returns: {
          already_recorded: boolean;
          amount_paid_kobo: number;
          payment_id: string;
          status: InvoiceStatus;
          student_id: string;
        }[];
      };
      start_quiz_attempt: {
        Args: { p_quiz_id: string };
        Returns: QuizAttempt;
      };
      get_quiz_attempt_questions: {
        Args: { p_attempt_id: string };
        Returns: QuizAttemptQuestionRow[];
      };
      get_quiz_attempt_review: {
        Args: { p_attempt_id: string };
        Returns: QuizAttemptReviewRow[];
      };
      search_topic_notes: {
        Args: { p_query: string; p_limit?: number };
        Returns: TopicNoteSearchResult[];
      };
      search_messageable_users: {
        Args: { p_query: string; p_limit?: number };
        Returns: { id: string; full_name: string; role: string }[];
      };
      answer_quiz_question: {
        Args: {
          p_attempt_id: string;
          p_question_id: string;
          p_selected_option_id?: string | null;
          p_answer_text?: string | null;
          p_matched_pairs?: Record<string, string> | null;
        };
        Returns: void;
      };
      submit_quiz_attempt: {
        Args: { p_attempt_id: string };
        Returns: { score: number; total_points: number }[];
      };
      grade_quiz_essay_answers: {
        Args: { p_attempt_id: string; p_scores: Record<string, number> };
        Returns: { score: number; total_points: number }[];
      };
      replace_quiz_questions: {
        Args: {
          p_quiz_id: string;
          p_questions: {
            question_text: string;
            question_type: string;
            points: number;
            options: { text: string; match_prompt: string | null; is_correct: boolean }[];
          }[];
        };
        Returns: undefined;
      };
      create_quiz_with_questions: {
        Args: {
          p_subject_id: string;
          p_class_id: string;
          p_title: string;
          p_term: number;
          p_academic_year: string;
          p_created_by: string;
          p_duration_minutes: number;
          p_opens_at: string | null;
          p_closes_at: string | null;
          p_questions: {
            question_text: string;
            question_type: string;
            points: number;
            options: { text: string; match_prompt: string | null; is_correct: boolean }[];
          }[];
        };
        Returns: string;
      };
      replace_invoice_installments: {
        Args: {
          p_invoice_id: string;
          p_created_by: string;
          p_installments: { due_date: string; amount_kobo: number }[];
        };
        Returns: void;
      };
      send_fee_reminders: {
        Args: { p_min_days_between?: number };
        Returns: { reminders_sent: number; invoices_considered: number }[];
      };
      swap_transport_stop_order: {
        Args: { p_stop_a: string; p_stop_b: string };
        Returns: void;
      };
    };
  };
};
