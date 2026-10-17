/**
 * Shared constants and types for the messaging UI's polling.
 *
 * Messaging used to subscribe to Supabase Realtime (postgres_changes on
 * `messages`). It now polls server actions instead, so there's no
 * websocket to keep alive and no dependency on `messages` being in the
 * supabase_realtime publication.
 */

export const MESSAGE_POLL_MS = {
  /** An open conversation: the one place latency is felt. */
  thread: 4_000,
  /** The inbox list. */
  inbox: 10_000,
  /** The sidebar unread badge, which is mounted on every dashboard page. */
  badge: 30_000,
} as const;

export type ThreadMessage = {
  id: string;
  sender_id: string;
  content: string;
  sent_at: string;
};

export type InboxConversation = {
  partnerId: string;
  partnerName: string;
  partnerRole: string;
  lastMessage: string;
  lastSentAt: string;
  unread: number;
  isArchived: boolean;
};

export type InboxView = "active" | "archived";

export type InboxData = {
  conversations: InboxConversation[];
  archivedCount: number;
};
