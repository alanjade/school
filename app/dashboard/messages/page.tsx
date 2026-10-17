import Link from "next/link";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getInboxConversations } from "@/lib/actions/messages";
import { NewConversationSearch } from "@/components/NewConversationSearch";
import { MessageInbox } from "@/components/MessageInbox";
import { redirect } from "next/navigation";

export default async function MessagesInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const resolvedSearchParams = await searchParams;

  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }
  const view = resolvedSearchParams.view === "archived" ? "archived" : "active";

  const { conversations, archivedCount } = (await getInboxConversations(view)) ?? {
    conversations: [],
    archivedCount: 0,
  };

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Messages</h1>
        <NewConversationSearch />
      </div>

      <div className="mb-4 flex gap-2">
        <Link
          href="/dashboard/messages"
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            view === "active" ? "border-leaf bg-leaf-soft text-leaf" : "border-rule text-ink-soft"
          }`}
        >
          Active
        </Link>
        <Link
          href="/dashboard/messages?view=archived"
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            view === "archived" ? "border-leaf bg-leaf-soft text-leaf" : "border-rule text-ink-soft"
          }`}
        >
          Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
        </Link>
      </div>

      <MessageInbox initialConversations={conversations} view={view} />
    </div>
  );
}
