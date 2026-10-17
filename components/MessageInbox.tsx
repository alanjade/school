"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getInboxConversations } from "@/lib/actions/messages";
import { usePolling } from "@/lib/hooks/usePolling";
import { MESSAGE_POLL_MS, type InboxConversation, type InboxView } from "@/lib/messagePolling";
import { ArchiveConversationButton } from "@/components/ArchiveConversationButton";

export function MessageInbox({
  initialConversations,
  view,
}: {
  initialConversations: InboxConversation[];
  view: InboxView;
}) {
  const [conversations, setConversations] = useState<InboxConversation[]>(initialConversations);

  // Re-sync when the server component re-renders with a fresh list (tab
  // switch, archive/unarchive, markThreadRead's revalidatePath).
  useEffect(() => {
    setConversations(initialConversations);
  }, [initialConversations]);

  // Polls the same server-side builder the page uses for its initial
  // render, so the list (names, unread counts, ordering, new
  // conversations, and the active/archived split) is always exactly what
  // a reload would show.
  usePolling(async () => {
    const fresh = await getInboxConversations(view);
    if (!fresh) return;
    // Skip the state update (and re-render) when nothing changed.
    setConversations((prev) =>
      JSON.stringify(prev) === JSON.stringify(fresh.conversations) ? prev : fresh.conversations
    );
  }, MESSAGE_POLL_MS.inbox);

  return (
    <div className="space-y-2">
      {conversations.map((convo) => (
        <div
          key={convo.partnerId}
          className="flex items-center justify-between rounded-lg border border-rule bg-white px-4 py-3 transition hover:border-leaf"
        >
          <Link href={`/dashboard/messages/${convo.partnerId}`} className="min-w-0 flex-1">
            <p className="font-medium text-ink">{convo.partnerName}</p>
            <p className="truncate text-sm text-ink-soft">{convo.lastMessage}</p>
          </Link>
          <div className="ml-3 flex items-center gap-3">
            {convo.unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-marigold px-1.5 text-xs font-medium text-ink">
                {convo.unread}
              </span>
            )}
            <ArchiveConversationButton partnerId={convo.partnerId} isArchived={convo.isArchived} />
          </div>
        </div>
      ))}

      {!conversations.length && <p className="text-sm text-ink-soft">No conversations yet.</p>}
    </div>
  );
}
