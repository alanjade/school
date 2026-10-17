import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueueSupabaseMock, type MockResult } from "./helpers/supabaseMock";

const state = vi.hoisted(() => ({
  queue: [] as MockResult[],
  client: null as ReturnType<typeof createQueueSupabaseMock> | null,
}));
const getCurrentProfile = vi.hoisted(() => vi.fn());

// One shared client for the session client and the admin client: the mock
// queue is positional, so a single instance keeps call order unambiguous.
const sharedClient = () => (state.client ??= createQueueSupabaseMock(state.queue));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => sharedClient()),
  getCurrentProfile,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => sharedClient()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));

import { getInboxConversations, getThreadMessagesSince } from "@/lib/actions/messages";

const ME = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const BEN = "33333333-3333-4333-8333-333333333333";

const rows = (data: unknown): MockResult => ({ data, error: null });
const signedInAsMe = () => getCurrentProfile.mockResolvedValue({ id: ME });

/** The table builder created by the Nth `supabase.from(...)` call. */
const builderAt = (n: number) => state.client!.from.mock.results[n].value;

afterEach(() => {
  vi.clearAllMocks();
  state.queue = [];
  state.client = null;
});

describe("getThreadMessagesSince", () => {
  it("rejects a partnerId that isn't a UUID before touching the database", async () => {
    signedInAsMe();
    // This string would otherwise be interpolated into the PostgREST .or() filter.
    const result = await getThreadMessagesSince(`${ANA}),sender_id.neq.x`, null);
    expect(result).toBeNull();
    expect(state.client).toBeNull();
  });

  it("rejects an unparseable cursor", async () => {
    signedInAsMe();
    expect(await getThreadMessagesSince(ANA, "not-a-date")).toBeNull();
    expect(state.client).toBeNull();
  });

  it("returns null when signed out", async () => {
    getCurrentProfile.mockResolvedValue(null);
    expect(await getThreadMessagesSince(ANA, null)).toBeNull();
    expect(state.client).toBeNull();
  });

  it("fetches the whole thread when there is no cursor yet", async () => {
    signedInAsMe();
    const msgs = [
      { id: "m1", sender_id: ANA, content: "hi", sent_at: "2026-10-17T10:00:00+00:00" },
    ];
    state.queue = [rows(msgs)];

    expect(await getThreadMessagesSince(ANA, null)).toEqual(msgs);

    const b = builderAt(0);
    expect(b.gte).not.toHaveBeenCalled();
    expect(b.order).toHaveBeenCalledWith("sent_at", { ascending: true });
    expect(b.or).toHaveBeenCalledWith(
      `and(sender_id.eq.${ME},recipient_id.eq.${ANA}),and(sender_id.eq.${ANA},recipient_id.eq.${ME})`
    );
  });

  it("applies the cursor inclusively (>=) so same-timestamp messages aren't skipped", async () => {
    signedInAsMe();
    const cursor = "2026-10-17T10:00:00.123456+00:00";
    state.queue = [rows([])];

    expect(await getThreadMessagesSince(ANA, cursor)).toEqual([]);
    expect(builderAt(0).gte).toHaveBeenCalledWith("sent_at", cursor);
  });

  it("returns null (not a throw) on a database error", async () => {
    signedInAsMe();
    state.queue = [{ data: null, error: { message: "boom" } }];
    expect(await getThreadMessagesSince(ANA, null)).toBeNull();
  });
});

describe("getInboxConversations", () => {
  const messages = [
    // newest first, as the query orders them
    {
      id: "4",
      sender_id: ME,
      recipient_id: BEN,
      content: "ok see you",
      read: true,
      sent_at: "2026-10-17T12:00:00Z",
    },
    {
      id: "3",
      sender_id: ANA,
      recipient_id: ME,
      content: "ping 2",
      read: false,
      sent_at: "2026-10-17T11:00:00Z",
    },
    {
      id: "2",
      sender_id: ANA,
      recipient_id: ME,
      content: "ping 1",
      read: false,
      sent_at: "2026-10-17T10:30:00Z",
    },
    {
      id: "1",
      sender_id: BEN,
      recipient_id: ME,
      content: "hello",
      read: true,
      sent_at: "2026-10-17T10:00:00Z",
    },
  ];
  const partners = [
    { id: ANA, full_name: "Ana Teacher", role: "teacher" },
    { id: BEN, full_name: "Ben Parent", role: "parent" },
  ];

  it("returns null when signed out", async () => {
    getCurrentProfile.mockResolvedValue(null);
    expect(await getInboxConversations("active")).toBeNull();
  });

  it("groups by partner, counts only unread messages TO me, and sorts newest first", async () => {
    signedInAsMe();
    state.queue = [rows(messages), rows([]), rows(partners)];

    const result = await getInboxConversations("active");

    expect(result?.archivedCount).toBe(0);
    expect(result?.conversations).toEqual([
      {
        partnerId: BEN,
        partnerName: "Ben Parent",
        partnerRole: "parent",
        lastMessage: "ok see you",
        lastSentAt: "2026-10-17T12:00:00Z",
        unread: 0, // my own outgoing message never counts
        isArchived: false,
      },
      {
        partnerId: ANA,
        partnerName: "Ana Teacher",
        partnerRole: "teacher",
        lastMessage: "ping 2",
        lastSentAt: "2026-10-17T11:00:00Z",
        unread: 2,
        isArchived: false,
      },
    ]);
  });

  it("splits archived from active and reports the archived count on either tab", async () => {
    signedInAsMe();
    state.queue = [rows(messages), rows([{ partner_id: BEN }]), rows(partners)];
    const active = await getInboxConversations("active");
    expect(active?.conversations.map((c) => c.partnerId)).toEqual([ANA]);
    expect(active?.archivedCount).toBe(1);

    state.client = null;
    state.queue = [rows(messages), rows([{ partner_id: BEN }]), rows(partners)];
    const archived = await getInboxConversations("archived");
    expect(archived?.conversations.map((c) => c.partnerId)).toEqual([BEN]);
    expect(archived?.conversations[0].isArchived).toBe(true);
    expect(archived?.archivedCount).toBe(1);
  });

  it("falls back to 'Unknown' when a partner's profile can't be loaded", async () => {
    signedInAsMe();
    state.queue = [rows(messages.slice(3)), rows([]), rows([])];
    const result = await getInboxConversations("active");
    expect(result?.conversations[0]).toMatchObject({ partnerName: "Unknown", partnerRole: "" });
  });

  it("handles an empty inbox without a partner lookup", async () => {
    signedInAsMe();
    state.queue = [rows([]), rows([])]; // no third result: getMessagePartners must short-circuit
    expect(await getInboxConversations("active")).toEqual({ conversations: [], archivedCount: 0 });
  });
});
