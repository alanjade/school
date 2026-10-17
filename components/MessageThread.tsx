"use client";

import { useEffect, useRef, useState } from "react";
import { getThreadMessagesSince, markThreadRead } from "@/lib/actions/messages";
import { usePolling } from "@/lib/hooks/usePolling";
import { MESSAGE_POLL_MS, type ThreadMessage as Message } from "@/lib/messagePolling";

function latestSentAt(messages: Message[]): string | null {
  let latest: string | null = null;
  for (const m of messages) {
    if (latest === null || new Date(m.sent_at).getTime() > new Date(latest).getTime()) {
      latest = m.sent_at;
    }
  }
  return latest;
}

export function MessageThread({
  currentUserId,
  partnerId,
  initialMessages,
}: {
  currentUserId: string;
  partnerId: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set(initialMessages.map((m) => m.id)));
  // Polling cursor: only ask the server for messages at/after the newest
  // one we already have.
  const cursor = useRef<string | null>(latestSentAt(initialMessages));

  // Keep in sync if the server component re-renders with a fresh initial
  // list (e.g. after sending a message or markThreadRead's revalidatePath),
  // without duplicating anything polling appended in the meantime.
  useEffect(() => {
    setMessages(initialMessages);
    seenIds.current = new Set(initialMessages.map((m) => m.id));
    cursor.current = latestSentAt(initialMessages);
  }, [initialMessages]);

  // Mark any messages from this partner already unread as of page load
  // now that the thread is open — this has to happen here (client-
  // invoked) rather than during the server component's render, since
  // markThreadRead() calls revalidatePath and Next.js doesn't allow
  // that during render.
  useEffect(() => {
    markThreadRead(partnerId);
  }, [partnerId]);

  usePolling(async () => {
    const fresh = await getThreadMessagesSince(partnerId, cursor.current);
    if (!fresh?.length) return;

    // The cursor row itself comes back every poll (>= compare), and our
    // own just-sent messages may already be here via router.refresh().
    const unseen = fresh.filter((m) => !seenIds.current.has(m.id));
    if (!unseen.length) return;

    for (const m of unseen) seenIds.current.add(m.id);
    // Every unseen row is >= the old cursor, so its newest sent_at is the new one.
    cursor.current = latestSentAt(unseen) ?? cursor.current;
    setMessages((prev) => [...prev, ...unseen]);

    // The thread is open and being viewed, so anything new from the
    // partner is read immediately.
    if (unseen.some((m) => m.sender_id === partnerId)) {
      markThreadRead(partnerId);
    }
  }, MESSAGE_POLL_MS.thread);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-rule bg-white p-4">
      {messages.map((m) => {
        const isMine = m.sender_id === currentUserId;
        return (
          <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                isMine ? "bg-marigold text-ink" : "bg-paper text-ink"
              }`}
            >
              <p>{m.content}</p>
              <p className="mt-1 text-[10px] text-ink-soft">
                {new Date(m.sent_at).toLocaleString()}
              </p>
            </div>
          </div>
        );
      })}

      {!messages.length && (
        <p className="text-center text-sm text-ink-soft">No messages yet — say hello.</p>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
