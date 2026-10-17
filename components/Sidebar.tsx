"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole, StaffRole } from "@/types/database";
import { SignOutButton } from "@/components/SignOutButton";
import { LiveMessagesBadge } from "@/components/LiveMessagesBadge";

const NAV_BY_ROLE: Record<UserRole, { label: string; href: string }[]> = {
  student: [
    { label: "My subjects", href: "/dashboard/student" },
    { label: "Timetable", href: "/dashboard/student/timetable" },
    { label: "Homework", href: "/dashboard/student/homework" },
    { label: "Grades", href: "/dashboard/student/grades" },
    { label: "Quizzes", href: "/dashboard/student/quizzes" },
    { label: "Report Card", href: "/dashboard/student/report-card" },
    { label: "Fees", href: "/dashboard/student/fees" },
    { label: "My Notes", href: "/dashboard/student/notes" },
    { label: "Search notes", href: "/dashboard/student/notes-search" },
    { label: "Library", href: "/dashboard/student/library" },
    { label: "Transport", href: "/dashboard/student/transport" },
    { label: "Messages", href: "/dashboard/messages" },
    { label: "Announcements", href: "/dashboard/announcements" },
  ],
  teacher: [
    { label: "My classes", href: "/dashboard/teacher" },
    { label: "Timetable", href: "/dashboard/teacher/timetable" },
    { label: "Attendance", href: "/dashboard/teacher/attendance" },
    { label: "Homework", href: "/dashboard/teacher/homework" },
    { label: "Grades", href: "/dashboard/teacher/grades" },
    { label: "Quizzes", href: "/dashboard/teacher/quizzes" },
    { label: "Search notes", href: "/dashboard/teacher/notes-search" },
    { label: "Messages", href: "/dashboard/messages" },
    { label: "Announcements", href: "/dashboard/announcements" },
  ],
  // Kept as a flat list for findActiveHref/etc — derived from
  // ADMIN_NAV_SECTIONS below so the two can't drift out of sync.
  admin: [],
  parent: [
    { label: "Overview", href: "/dashboard/parent" },
    { label: "Attendance", href: "/dashboard/parent/attendance" },
    { label: "Grades", href: "/dashboard/parent/grades" },
    { label: "Report Card", href: "/dashboard/parent/report-card" },
    { label: "Fees", href: "/dashboard/parent/fees" },
    { label: "Timetable", href: "/dashboard/parent/timetable" },
    { label: "Homework", href: "/dashboard/parent/homework" },
    { label: "Library", href: "/dashboard/parent/library" },
    { label: "Transport", href: "/dashboard/parent/transport" },
    { label: "Messages", href: "/dashboard/messages" },
    { label: "Announcements", href: "/dashboard/announcements" },
  ],
};

// The admin menu has 23 destinations — too many to scan as one flat
// list — so it's grouped into labeled sections instead. Every other
// role's list stays short enough that a flat list is still the
// simplest, most scannable option.
const ADMIN_NAV_SECTIONS: { section: string; items: { label: string; href: string }[] }[] = [
  {
    section: "Overview",
    items: [
      { label: "Overview", href: "/dashboard/admin" },
      { label: "Analytics", href: "/dashboard/admin/analytics" },
      { label: "Audit Log", href: "/dashboard/admin/audit-log" },
    ],
  },
  {
    section: "Academics",
    items: [
      { label: "Classes", href: "/dashboard/admin/classes" },
      { label: "Promote Students", href: "/dashboard/admin/classes/promote" },
      { label: "Academic Year Rollover", href: "/dashboard/admin/rollover" },
      { label: "Subjects", href: "/dashboard/admin/subjects" },
      { label: "Timetables", href: "/dashboard/admin/timetables" },
      { label: "Scheme of Work", href: "/dashboard/admin/curriculum" },
      { label: "Grade Moderation", href: "/dashboard/admin/grades" },
      { label: "Lesson Plan Review", href: "/dashboard/admin/lesson-plans" },
    ],
  },
  {
    section: "People",
    items: [
      { label: "Students", href: "/dashboard/admin/students" },
      { label: "Parents", href: "/dashboard/admin/parents" },
      { label: "Staff", href: "/dashboard/admin/staff" },
      { label: "ID Cards", href: "/dashboard/admin/id-cards" },
    ],
  },
  {
    section: "Fees",
    items: [{ label: "Fees", href: "/dashboard/admin/fees" }],
  },
  {
    section: "Facilities",
    items: [
      { label: "Library", href: "/dashboard/library" },
      { label: "Inventory", href: "/dashboard/admin/inventory" },
      { label: "Hostels", href: "/dashboard/admin/hostels" },
      { label: "Transport", href: "/dashboard/admin/transport" },
    ],
  },
  {
    section: "Communication",
    items: [
      { label: "Messages", href: "/dashboard/messages" },
      { label: "Announcements", href: "/dashboard/announcements" },
      { label: "Bulk Email", href: "/dashboard/admin/bulk-email" },
    ],
  },
  {
    section: "Settings",
    items: [{ label: "Settings", href: "/dashboard/admin/settings" }],
  },
];

NAV_BY_ROLE.admin = ADMIN_NAV_SECTIONS.flatMap((s) => s.items);

// A driver isn't teaching staff — they only need their own route and
// the general messaging/announcements areas, not the full teacher menu
// (classes, grades, quizzes, etc. don't apply to them).
const DRIVER_NAV: { label: string; href: string }[] = [
  { label: "My route", href: "/dashboard/driver" },
  { label: "Messages", href: "/dashboard/messages" },
  { label: "Announcements", href: "/dashboard/announcements" },
];

// A bursar isn't teaching staff either — fee structures, invoices, and
// payments cover their whole job, not the classroom-facing teacher menu.
const BURSAR_NAV: { label: string; href: string }[] = [
  { label: "Bursary", href: "/dashboard/bursar" },
  { label: "Fee structures", href: "/dashboard/bursar/structures" },
  { label: "Invoices & payments", href: "/dashboard/bursar/invoices" },
  { label: "Payment history", href: "/dashboard/bursar/payments" },
  { label: "Messages", href: "/dashboard/messages" },
  { label: "Announcements", href: "/dashboard/announcements" },
];

// Non-teaching staff (librarian, house parent, transport officer) are
// not classroom staff either, so they get the same shape as the driver
// and bursar menus: their own service area, then the shared
// messaging/announcements items -- not the full teacher menu.
const SERVICE_NAV_BY_STAFF_ROLE: Partial<Record<StaffRole, { label: string; href: string }[]>> = {
  librarian: [
    { label: "Library", href: "/dashboard/library" },
    { label: "Borrow / Return", href: "/dashboard/library/loans" },
    { label: "Messages", href: "/dashboard/messages" },
    { label: "Announcements", href: "/dashboard/announcements" },
  ],
  house_parent: [
    { label: "Hostel", href: "/dashboard/hostels" },
    { label: "Messages", href: "/dashboard/messages" },
    { label: "Announcements", href: "/dashboard/announcements" },
  ],
  transport_officer: [
    { label: "Transport", href: "/dashboard/transport" },
    { label: "Messages", href: "/dashboard/messages" },
    { label: "Announcements", href: "/dashboard/announcements" },
  ],
  driver: DRIVER_NAV,
  bursar: BURSAR_NAV,
};

// What the sidebar header shows under "School". Non-teaching staff are
// all `role: "teacher"` in the DB, so without this a librarian or bursar
// just saw "teacher".
const STAFF_ROLE_LABEL: Partial<Record<StaffRole, string>> = {
  hod: "Academic head",
  bursar: "Bursar",
  librarian: "Librarian",
  house_parent: "House parent",
  transport_officer: "Transport officer",
  driver: "Driver",
};

/**
 * Picks the single most specific matching nav item for the current path,
 * so a nested route (e.g. /dashboard/admin/classes/promote) doesn't also
 * light up a shorter sibling/parent item (e.g. /dashboard/admin/classes)
 * whose href happens to be a string prefix of it.
 */
type NotificationCounts = {
  messages: number;
  announcements: number;
  homework: number;
};

// Which notification bucket lights up a given nav label. "Homework" only
// carries a count for students (unseen graded feedback) -- for
// teachers/parents/admin get_notification_counts() always returns 0 there,
// since it's their own homework's grade that's new, not something they're
// tracking on someone else's submission.
function countFor(label: string, counts: NotificationCounts): number {
  if (label === "Messages") return counts.messages;
  if (label === "Announcements") return counts.announcements;
  if (label === "Homework") return counts.homework;
  return 0;
}

function NotificationBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-marigold px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function findActiveHref(pathname: string, items: { href: string }[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    const isExactOrNested = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const isMoreSpecific = best === null || item.href.length > best.length;
    if (isExactOrNested && isMoreSpecific) {
      best = item.href;
    }
  }
  return best;
}

export function Sidebar({
  role,
  fullName,
  staffRole,
  userId,
  notificationCounts,
}: {
  role: UserRole;
  fullName: string;
  staffRole?: StaffRole | null;
  userId: string;
  notificationCounts?: NotificationCounts;
}) {
  const counts: NotificationCounts = notificationCounts ?? {
    messages: 0,
    announcements: 0,
    homework: 0,
  };
  const serviceNav =
    role === "teacher" && staffRole ? SERVICE_NAV_BY_STAFF_ROLE[staffRole] : undefined;
  const items =
    serviceNav ??
    (role === "teacher" && staffRole === "hod"
      ? [
          ...NAV_BY_ROLE.teacher,
          { label: "Lesson Plan Review", href: "/dashboard/teacher/lesson-plans" },
        ]
      : NAV_BY_ROLE[role]);
  const roleLabel = (role === "teacher" && staffRole && STAFF_ROLE_LABEL[staffRole]) || role;
  const pathname = usePathname();
  const activeHref = findActiveHref(pathname, items);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Closing the drawer via a plain setMobileOpen(false) inside a nav
  // link's onClick looked like it did nothing until the new page had
  // fully loaded: Next's <Link> wraps its own navigation in
  // startTransition, and a state update fired in that same click
  // handler gets swept into that transition too -- so React deferred
  // actually painting the closed drawer until the navigation/transition
  // finished, instead of immediately. flushSync forces this specific
  // update to apply synchronously, ahead of/outside that transition.
  function closeMobileNav() {
    flushSync(() => setMobileOpen(false));
  }

  const activeSectionName = ADMIN_NAV_SECTIONS.find((g) =>
    g.items.some((i) => i.href === activeHref)
  )?.section;

  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(activeSectionName ? [activeSectionName] : [])
  );

  // Load any previously-saved open/closed state once on mount, then keep
  // the active section forced open on top of it (in case the saved state
  // predates navigating somewhere new).
  useEffect(() => {
    const saved = localStorage.getItem("admin-sidebar-sections");
    if (saved) {
      const set = new Set<string>(JSON.parse(saved));
      if (activeSectionName) set.add(activeSectionName);
      setOpenSections(set);
    }
    // Deliberately mount-only: re-running this on every activeSectionName
    // change would clobber a section the user just manually closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSection(section: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      localStorage.setItem("admin-sidebar-sections", JSON.stringify([...next]));
      return next;
    });
  }

  // Close the drawer automatically on navigation — otherwise it stays
  // open over the new page until manually dismissed.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent the page behind the drawer from scrolling while it's open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Mobile top bar — hidden from lg upward, where the sidebar is
          always visible instead. */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-paper px-4 py-3 lg:hidden print:hidden">
        <p className="font-display text-lg font-semibold text-ink">School</p>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          className="rounded-lg border border-rule p-2 text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Backdrop — only rendered (and only intercepts clicks) while the
          mobile drawer is open. */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-ink/30 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col justify-between border-r border-rule bg-paper px-4 py-6 transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:z-auto lg:w-56 lg:translate-x-0 print:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="min-h-0 overflow-y-auto">
          <div className="mb-8 flex items-center justify-between px-2">
            <div>
              <p className="font-display text-lg font-semibold text-ink">School</p>
              <p className="text-xs uppercase tracking-wide text-ink-soft">{roleLabel}</p>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="rounded-lg p-1 text-ink-soft lg:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <nav className="space-y-1">
            {role === "admin" ? (
              ADMIN_NAV_SECTIONS.map((group) => {
                const isOpen = openSections.has(group.section);
                return (
                  <div key={group.section} className="mb-1.5">
                    <button
                      type="button"
                      onClick={() => toggleSection(group.section)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between px-3 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft/70"
                    >
                      {group.section}
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        aria-hidden="true"
                        className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
                      >
                        <path
                          d="M3 1.5L7 5l-4 3.5"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="mt-0.5">
                        {group.items.map((item) => {
                          const isActive = item.href === activeHref;
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              aria-current={isActive ? "page" : undefined}
                              onClick={closeMobileNav}
                              className={`block rounded-lg px-3 py-1.5 text-sm transition ${
                                isActive
                                  ? "bg-leaf-soft font-medium text-leaf"
                                  : "text-ink hover:bg-leaf-soft hover:text-leaf"
                              }`}
                            >
                              {item.label}
                              {item.label === "Messages" ? (
                                <LiveMessagesBadge initialCount={counts.messages} />
                              ) : (
                                <NotificationBadge count={countFor(item.label, counts)} />
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <>
                {items.map((item) => {
                  const isActive = item.href === activeHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      onClick={closeMobileNav}
                      className={`block rounded-lg px-3 py-2 text-sm transition ${
                        isActive
                          ? "bg-leaf-soft font-medium text-leaf"
                          : "text-ink hover:bg-leaf-soft hover:text-leaf"
                      }`}
                    >
                      {item.label}
                      {item.label === "Messages" ? (
                        <LiveMessagesBadge initialCount={counts.messages} />
                      ) : (
                        <NotificationBadge count={countFor(item.label, counts)} />
                      )}
                    </Link>
                  );
                })}
              </>
            )}
          </nav>
        </div>
        <div className="shrink-0 space-y-2 border-t border-rule px-2 pt-4">
          <p className="text-sm text-ink-soft">{fullName}</p>
          <SignOutButton />
        </div>
      </aside>
    </>
  );
}
