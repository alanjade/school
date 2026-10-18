import Link from "next/link";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { RoomOccupants } from "@/components/RoomOccupants";
import { AssignStudentForm } from "@/components/AssignStudentForm";
import { HostelWaitlistPanel } from "@/components/HostelWaitlistPanel";

export default async function HostelRoomPage({
  params,
}: {
  params: Promise<{ hostelId: string; roomId: string }>;
}) {
  const { hostelId, roomId } = await params;
  const supabase = createClient();
  const viewer = await getCurrentProfile();
  // Admins came from their hostels page, a house parent from theirs.
  const backHref = viewer?.role === "admin" ? "/dashboard/admin/hostels" : "/dashboard/hostels";

  const { data: room } = await supabase
    .from("hostel_rooms")
    .select("id, room_number, capacity, hostels(name)")
    .eq("id", roomId)
    .single();

  const { data: assignments } = await supabase
    .from("hostel_assignments")
    .select(
      "id, student_id, academic_year, assigned_at, student_profiles(admission_no, profiles(full_name))"
    )
    .eq("room_id", roomId)
    .is("unassigned_at", null)
    .order("assigned_at", { ascending: true });

  const studentIds = (assignments ?? []).map((a) => a.student_id);

  const { data: openLeaveLogs } = studentIds.length
    ? await supabase
        .from("hostel_leave_logs")
        .select("id, student_id, reason, out_at, expected_return_at")
        .in("student_id", studentIds)
        .is("returned_at", null)
    : { data: [] };

  const { data: openVisitorLogs } = studentIds.length
    ? await supabase
        .from("hostel_visitor_logs")
        .select("id, student_id, visitor_name, purpose, checked_in_at")
        .in("student_id", studentIds)
        .is("checked_out_at", null)
    : { data: [] };

  const { data: allStudents } = await supabase
    .from("student_profiles")
    .select("id, admission_no, profiles(full_name)")
    .order("admission_no", { ascending: true });

  const { data: waitlist } = await supabase
    .from("hostel_waitlist")
    .select("id, student_id, requested_at, student_profiles(admission_no, profiles(full_name))")
    .eq("hostel_id", hostelId)
    .is("fulfilled_at", null)
    .is("cancelled_at", null)
    .order("requested_at", { ascending: true });

  const studentOptions = (allStudents ?? [])
    .filter((s) => !studentIds.includes(s.id))
    .map((s) => ({
      id: s.id,
      label: `${s.profiles?.full_name ?? "Unknown"}${s.admission_no ? ` (${s.admission_no})` : ""}`,
    }));

  if (!room) {
    return (
      <div className="max-w-lg">
        <p className="text-sm text-clay">Room not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <Link href={backHref} className="mb-4 inline-block text-sm text-leaf hover:underline">
        ← Back to hostels
      </Link>

      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">
        {room.hostels?.name} · Room {room.room_number}
      </h1>
      <p className="mb-6 text-sm text-ink-soft">
        {(assignments ?? []).length}/{room.capacity} occupied
      </p>

      <div className="mb-6">
        <h2 className="mb-2 font-display text-lg font-semibold text-ink">Assign a student</h2>
        <AssignStudentForm roomId={roomId} hostelId={hostelId} students={studentOptions} />
      </div>

      {!!waitlist?.length && (
        <div className="mb-6">
          <h2 className="mb-2 font-display text-lg font-semibold text-ink">Waitlist</h2>
          <HostelWaitlistPanel
            hostelId={hostelId}
            entries={waitlist.map((w) => ({
              id: w.id,
              fullName: w.student_profiles?.profiles?.full_name ?? "Unknown",
              admissionNo: w.student_profiles?.admission_no ?? null,
              requestedAt: w.requested_at,
            }))}
          />
        </div>
      )}

      <div>
        <h2 className="mb-2 font-display text-lg font-semibold text-ink">Occupants</h2>
        <RoomOccupants
          roomId={roomId}
          assignments={(assignments ?? []).map((a) => ({
            id: a.id,
            studentId: a.student_id,
            fullName: a.student_profiles?.profiles?.full_name ?? "Unknown",
            admissionNo: a.student_profiles?.admission_no ?? null,
          }))}
          openLeaveLogs={(openLeaveLogs ?? []).map((l) => ({
            id: l.id,
            studentId: l.student_id,
            reason: l.reason,
            outAt: l.out_at,
            expectedReturnAt: l.expected_return_at,
          }))}
          openVisitorLogs={(openVisitorLogs ?? []).map((v) => ({
            id: v.id,
            studentId: v.student_id,
            visitorName: v.visitor_name,
            purpose: v.purpose,
            checkedInAt: v.checked_in_at,
          }))}
        />
        {!assignments?.length && <p className="text-sm text-ink-soft">No one assigned yet.</p>}
      </div>
    </div>
  );
}
