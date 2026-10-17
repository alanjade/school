"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { throwDbError } from "@/lib/errors/db";
import { runAction } from "@/lib/actionResult";
import type { InboxData, InboxView, ThreadMessage } from "@/lib/messagePolling";

/**
 * Returns just the display name/role for a message-thread partner.
 * profiles' own RLS only lets a caller read their own row (or, for
 * admins/teachers, everyone) -- so a student or parent opening a thread
 * with a teacher they found via search_messageable_users has no
 * row-level access to that teacher's profile via the plain session
 * client. Needs the admin client to bypass that, same reasoning as the
 * search RPC: only full_name/role ever come back, nothing more
 * sensitive, so this isn't widening access beyond what starting the
 * conversation already exposed.
 */
export async function getMessagePartner(
  userId: string
): Promise<{ full_name: string; role: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("full_name, role")
    .eq("id", userId)
    .maybeSingle();
  return data;
}

/**
 * Bulk version of getMessagePartner, for the inbox list where a student
 * or parent may have several conversations with teachers/admins whose
 * profiles rows their own session can't read (same RLS gap noted
 * above). Returns a plain array rather than a Map since server actions
 * can only return plain serializable data across the client/server
 * boundary.
 */
export async function getMessagePartners(
  userIds: string[]
): Promise<{ id: string; full_name: string; role: string }[]> {
  if (!userIds.length) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id, full_name, role").in("id", userIds);
  return data ?? [];
}

export async function sendMessage(recipientId: string, content: string) {
  return runAction(async () => {
    const profile = await getCurrentProfile();
    if (!profile) {
      throw new Error("You must be signed in to send messages.");
    }

    if (!content.trim()) {
      throw new Error("Message can't be empty.");
    }

    const supabase = createClient();

    // Same RLS gap as getMessagePartner above: a student/parent sending to
    // a teacher has no row-level access to that teacher's profiles row via
    // the session client, so this existence/active check needs the admin
    // client too -- it only ever reads id/is_active, never anything more
    // sensitive, so it's exposing nothing beyond "does this id exist and
    // is it active", which messages_insert_sender already implies anyone
    // may need to know before sending.
    const admin = createAdminClient();
    const { data: recipient, error: recipientError } = await admin
      .from("profiles")
      .select("id, is_active")
      .eq("id", recipientId)
      .maybeSingle();

    if (recipientError || !recipient) {
      throw new Error("Recipient not found.");
    }

    if (recipient.id === profile.id) {
      throw new Error("You can't message yourself.");
    }

    if (!recipient.is_active) {
      throw new Error("That account is no longer active.");
    }

    const { error } = await supabase.from("messages").insert({
      sender_id: profile.id,
      recipient_id: recipientId,
      content: content.trim(),
    });

    if (error) throwDbError(error);

    revalidatePath(`/dashboard/messages/${recipientId}`);
    revalidatePath("/dashboard/messages");
  });
}

export async function markThreadRead(partnerId: string) {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const supabase = createClient();

  await supabase
    .from("messages")
    .update({ read: true })
    .eq("recipient_id", profile.id)
    .eq("sender_id", partnerId)
    .eq("read", false);

  revalidatePath("/dashboard/messages");
}

/**
 * Backs the polling sidebar badge (LiveMessagesBadge) rather than
 * get_notification_counts(): that RPC only runs once per dashboard
 * *layout* mount, and Next.js doesn't re-run a layout's server data on
 * a soft client-side navigation between routes under it -- so the
 * badge would otherwise go stale the moment a new message arrives
 * while the user is already inside /dashboard. Scoped to the caller's
 * own recipient_id, so the plain session client (and its RLS) is fine
 * here -- no admin client needed, unlike the partner-lookup actions
 * above.
 */
export async function getUnreadMessagesCount(): Promise<number> {
  const profile = await getCurrentProfile();
  if (!profile) return 0;

  const supabase = createClient();
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", profile.id)
    .eq("read", false);

  return count ?? 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Upper bound on rows returned by one thread poll; the cursor catches up on the next tick. */
const THREAD_POLL_LIMIT = 200;

/**
 * Polling read for an open conversation: every message between the caller
 * and partnerId with sent_at >= `after` (or the whole thread when `after`
 * is null, i.e. the thread was empty on load), oldest first. Includes the
 * caller's own messages so a second tab/device stays in sync.
 *
 * `>=` rather than `>` is deliberate: two messages can share a timestamp,
 * and a strict compare could skip the second one forever. The client
 * dedupes by id, so re-receiving the cursor row is harmless.
 *
 * Returns null (rather than throwing) on bad input, no session, or a DB
 * error -- a poll failing should be silent and simply retried. partnerId
 * is validated as a UUID because it is interpolated into a PostgREST
 * `.or()` filter string and arrives straight from the browser.
 */
export async function getThreadMessagesSince(
  partnerId: string,
  after: string | null
): Promise<ThreadMessage[] | null> {
  if (!UUID_RE.test(partnerId)) return null;
  if (after !== null && Number.isNaN(Date.parse(after))) return null;

  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = createClient();

  let query = supabase
    .from("messages")
    .select("id, sender_id, content, sent_at")
    .or(
      `and(sender_id.eq.${profile.id},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${profile.id})`
    )
    .order("sent_at", { ascending: true })
    .limit(THREAD_POLL_LIMIT);

  if (after !== null) query = query.gte("sent_at", after);

  const { data, error } = await query;
  if (error) return null;
  return (data ?? []) as ThreadMessage[];
}

/**
 * Builds the inbox list (one row per conversation partner, newest first,
 * filtered to the Active or Archived tab). Shared by the inbox page's
 * server render and by MessageInbox's polling so the two can never drift.
 *
 * Partner names go through the admin-backed getMessagePartners because
 * profiles RLS hides teacher/admin rows from students and parents.
 */
export async function getInboxConversations(view: InboxView): Promise<InboxData | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = createClient();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_id, recipient_id, content, read, sent_at")
    .or(`sender_id.eq.${profile.id},recipient_id.eq.${profile.id}`)
    .order("sent_at", { ascending: false });

  const { data: archives } = await supabase
    .from("conversation_archives")
    .select("partner_id")
    .eq("user_id", profile.id);

  const archivedPartnerIds = new Set((archives ?? []).map((a) => a.partner_id));

  // Group into one row per conversation partner, keeping the most
  // recent message and counting unread messages FROM that partner.
  const grouped = new Map<string, { lastMessage: string; lastSentAt: string; unread: number }>();

  for (const m of messages ?? []) {
    const partnerId = m.sender_id === profile.id ? m.recipient_id : m.sender_id;
    if (!grouped.has(partnerId)) {
      grouped.set(partnerId, { lastMessage: m.content, lastSentAt: m.sent_at, unread: 0 });
    }
    if (m.recipient_id === profile.id && !m.read) {
      grouped.get(partnerId)!.unread += 1;
    }
  }

  const partnerIds = [...grouped.keys()];
  const partners = await getMessagePartners(partnerIds);
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  const archivedCount = partnerIds.filter((id) => archivedPartnerIds.has(id)).length;

  const conversations = [...grouped.entries()]
    .filter(([partnerId]) =>
      view === "archived" ? archivedPartnerIds.has(partnerId) : !archivedPartnerIds.has(partnerId)
    )
    .sort((a, b) => new Date(b[1].lastSentAt).getTime() - new Date(a[1].lastSentAt).getTime())
    .map(([partnerId, convo]) => ({
      partnerId,
      partnerName: partnerById.get(partnerId)?.full_name ?? "Unknown",
      partnerRole: partnerById.get(partnerId)?.role ?? "",
      lastMessage: convo.lastMessage,
      lastSentAt: convo.lastSentAt,
      unread: convo.unread,
      isArchived: archivedPartnerIds.has(partnerId),
    }));

  return { conversations, archivedCount };
}

/**
 * Deletes every message between the current user and partnerId.
 * IMPORTANT: a message row is shared by both participants — there's no
 * per-user "hide for me" concept for messages themselves (that's what
 * archiving is for). This permanently removes the conversation for
 * both people, not just the caller.
 *
 * The deletion is audit-logged so admins can see who wiped what and
 * approximately how many messages were removed — no data recovery, but
 * at least there's a trace if a dispute arises later.
 */
export async function deleteConversation(partnerId: string) {
  return runAction(async () => {
    const profile = await getCurrentProfile();
    if (!profile) {
      throw new Error("You must be signed in.");
    }

    const supabase = createClient();

    // Count messages before deleting so the audit entry is useful
    const { count: messageCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .or(
        `and(sender_id.eq.${profile.id},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${profile.id})`
      );

    const { error } = await supabase
      .from("messages")
      .delete()
      .or(
        `and(sender_id.eq.${profile.id},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${profile.id})`
      );

    if (error) throwDbError(error);

    // Clean up any archive record too, so a future conversation with the
    // same person doesn't start out pre-archived.
    await supabase
      .from("conversation_archives")
      .delete()
      .eq("user_id", profile.id)
      .eq("partner_id", partnerId);

    // Best-effort audit trail — deletion affects both parties so admins
    // can investigate if the other participant reports missing messages.
    await writeAuditLog({
      entityType: "conversation",
      entityId: profile.id,
      action: "conversation_deleted",
      actorId: profile.id,
      metadata: {
        deleted_by: profile.id,
        partner_id: partnerId,
        message_count: messageCount ?? 0,
      },
    });

    revalidatePath("/dashboard/messages");
  });
}

/**
 * Archiving is per-viewer: it hides a conversation from your own inbox
 * without affecting the other participant or deleting anything. Messages
 * keep flowing and can still be read by opening the thread directly.
 */
export async function archiveConversation(partnerId: string) {
  return runAction(async () => {
    const profile = await getCurrentProfile();
    if (!profile) {
      throw new Error("You must be signed in.");
    }

    const supabase = createClient();

    const { error } = await supabase
      .from("conversation_archives")
      .upsert({ user_id: profile.id, partner_id: partnerId });

    if (error) throwDbError(error);

    revalidatePath("/dashboard/messages");
  });
}

export async function unarchiveConversation(partnerId: string) {
  return runAction(async () => {
    const profile = await getCurrentProfile();
    if (!profile) {
      throw new Error("You must be signed in.");
    }

    const supabase = createClient();

    const { error } = await supabase
      .from("conversation_archives")
      .delete()
      .eq("user_id", profile.id)
      .eq("partner_id", partnerId);

    if (error) throwDbError(error);

    revalidatePath("/dashboard/messages");
  });
}
