import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { EmptyState } from "@/components/EmptyState";

/** A house parent's view: the hostel(s) they run, with room occupancy. */
export default async function HouseParentHostelsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Admins manage everything (create hostels, fees) from their own page.
  if (profile.role === "admin") redirect("/dashboard/admin/hostels");

  const supabase = createClient();

  const { data: hostels } = await supabase
    .from("hostels")
    .select("id, name, gender, capacity")
    .eq("house_parent_id", profile.id)
    .order("name", { ascending: true });

  const hostelIds = (hostels ?? []).map((h) => h.id);

  const { data: rooms } = hostelIds.length
    ? await supabase
        .from("hostel_rooms")
        .select("id, hostel_id, room_number, capacity")
        .in("hostel_id", hostelIds)
        .order("room_number", { ascending: true })
    : { data: [] };

  const { data: activeAssignments } = (rooms ?? []).length
    ? await supabase
        .from("hostel_assignments")
        .select("room_id")
        .in(
          "room_id",
          (rooms ?? []).map((r) => r.id)
        )
        .is("unassigned_at", null)
    : { data: [] };

  const occupancyByRoom = new Map<string, number>();
  for (const a of activeAssignments ?? []) {
    occupancyByRoom.set(a.room_id, (occupancyByRoom.get(a.room_id) ?? 0) + 1);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 font-display text-2xl font-semibold text-ink">Hostel</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Your boarding house, its rooms and occupancy. Open a room to assign students and log leave
        and visitors.
      </p>

      <div className="space-y-4">
        {(hostels ?? []).map((h) => {
          const hostelRooms = (rooms ?? []).filter((r) => r.hostel_id === h.id);
          const totalCapacity = hostelRooms.reduce((sum, r) => sum + r.capacity, 0);
          const totalOccupied = hostelRooms.reduce(
            (sum, r) => sum + (occupancyByRoom.get(r.id) ?? 0),
            0
          );
          return (
            <div key={h.id} className="rounded-xl border border-rule bg-white p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold text-ink">{h.name}</p>
                  <p className="text-xs text-ink-soft">{h.gender === "male" ? "Boys" : "Girls"}</p>
                </div>
                <span className="shrink-0 rounded-full bg-leaf-soft px-2.5 py-1 text-xs font-medium text-leaf">
                  {totalOccupied}/{totalCapacity || h.capacity || "—"} occupied
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {hostelRooms.map((r) => {
                  const occupied = occupancyByRoom.get(r.id) ?? 0;
                  const full = occupied >= r.capacity;
                  return (
                    <Link
                      key={r.id}
                      href={`/dashboard/hostels/${h.id}/rooms/${r.id}`}
                      className={`rounded-lg border px-3 py-2 text-center text-sm ${
                        full
                          ? "border-clay/30 bg-clay/5 text-clay"
                          : "border-rule text-ink hover:bg-leaf-soft"
                      }`}
                    >
                      <p className="font-medium">{r.room_number}</p>
                      <p className="text-xs opacity-80">
                        {occupied}/{r.capacity}
                      </p>
                    </Link>
                  );
                })}
                {!hostelRooms.length && (
                  <p className="col-span-full text-sm text-ink-soft">
                    No rooms yet. An admin adds rooms.
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {!hostels?.length && (
          <EmptyState message="You aren't assigned as house parent of a hostel yet." />
        )}
      </div>
    </div>
  );
}
