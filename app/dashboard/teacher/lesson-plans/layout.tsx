import { redirect } from "next/navigation";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";

/**
 * Lesson plan review is a HOD-only surface. The parent teacher layout only
 * checks role === "teacher", so a plain teacher could otherwise open this
 * route by URL. (RLS and approveLessonPlan/rejectLessonPlan already refuse
 * non-HODs -- this just keeps them from landing on an empty page.)
 */
export default async function LessonPlanReviewLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = createClient();
  const { data: teacher } = await supabase
    .from("teacher_profiles")
    .select("staff_role")
    .eq("id", profile.id)
    .single();

  if (teacher?.staff_role !== "hod") {
    redirect("/dashboard/teacher");
  }

  return <>{children}</>;
}
