import Link from "next/link";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { getMessagePartner } from "@/lib/actions/messages";
import { MessageComposer } from "@/components/MessageComposer";
import { MessageThread } from "@/components/MessageThread";
import { ArchiveConversationButton } from "@/components/ArchiveConversationButton";
import { DeleteConversationButton } from "@/components/DeleteConversationButton";
import { redirect } from "next/navigation";

export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const resolvedParams = await params;

  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }
  const supabase = createClient();

  const partner = await getMessagePartner(resolvedParams.userId);

  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_id, content, sent_at")
    .or(
      `and(sender_id.eq.${profile.id},recipient_id.eq.${resolvedParams.userId}),and(sender_id.eq.${resolvedParams.userId},recipient_id.eq.${profile.id})`
    )
    .order("sent_at", { ascending: true });

  const { data: archiveRow } = await supabase
    .from("conversation_archives")
    .select("partner_id")
    .eq("user_id", profile.id)
    .eq("partner_id", resolvedParams.userId)
    .maybeSingle();

  return (
    <div className="flex h-[calc(100vh-4rem)] max-w-xl flex-col">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <Link href="/dashboard/messages" className="text-sm text-leaf hover:underline">
            ← All messages
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
            {partner?.full_name ?? "Unknown"}
          </h1>
          <p className="text-xs capitalize text-ink-soft">{partner?.role}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ArchiveConversationButton partnerId={resolvedParams.userId} isArchived={!!archiveRow} />
          <DeleteConversationButton partnerId={resolvedParams.userId} />
        </div>
      </div>

      <MessageThread
        currentUserId={profile.id}
        partnerId={resolvedParams.userId}
        initialMessages={messages ?? []}
      />

      <div className="mt-4">
        <MessageComposer recipientId={resolvedParams.userId} />
      </div>
    </div>
  );
}
