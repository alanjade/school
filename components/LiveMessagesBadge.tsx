"use client";

import { useEffect, useState } from "react";
import { getUnreadMessagesCount } from "@/lib/actions/messages";
import { usePolling } from "@/lib/hooks/usePolling";
import { MESSAGE_POLL_MS } from "@/lib/messagePolling";

/**
 * The sidebar's other badges (announcements, homework) come from
 * get_notification_counts(), fetched once when the dashboard layout
 * mounts. That's fine for those -- but Next.js doesn't re-run a
 * layout's server data fetch on a soft client-side navigation between
 * routes under it, so a message that arrives (or gets read) while the
 * user is already inside /dashboard never updates that count until a
 * hard reload. This polls the true unread count so the nav badge stays
 * in sync with what the inbox list is showing.
 */
export function LiveMessagesBadge({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  usePolling(async () => {
    setCount(await getUnreadMessagesCount());
  }, MESSAGE_POLL_MS.badge);

  if (!count) return null;
  return (
    <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-marigold px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
