import { vi } from "vitest";

export type MockResult<T = unknown> = { data: T | null; error: unknown };

/**
 * Creates a fake Supabase client for unit-testing server actions without
 * a real database. Every chained call (`.from(...).select(...).eq(...)`,
 * ending in `.single()`/`.maybeSingle()`, or just awaited bare for
 * `.update()`/`.insert()`) and every `.rpc(...)` call resolves the next
 * entry from `queue`, in call order.
 *
 * This only works because each server action under test makes its DB
 * calls in a fixed, known sequence for a given input -- the queue is
 * positional, not matched by table/column. If a test's queue doesn't
 * match the actual call count, `nextResult()` throws with a clear message
 * rather than silently returning undefined.
 *
 * Every intermediate builder method (`select`/`eq`/`is`/`update`/
 * `insert`) just returns the same chainable object, so any call shape
 * works without per-method setup -- the mock doesn't care which columns
 * or filters were used, only how many terminal awaits happened.
 */
export function createQueueSupabaseMock(queue: MockResult[]) {
  let i = 0;
  const calls: { table?: string; op: string }[] = [];

  const nextResult = (op: string, table?: string): MockResult => {
    calls.push({ table, op });
    if (i >= queue.length) {
      throw new Error(
        `Supabase mock queue exhausted at call #${i + 1} (${op}${table ? ` on "${table}"` : ""}). ` +
          `Queued ${queue.length} result(s); calls so far: ${JSON.stringify(calls)}`
      );
    }
    return queue[i++];
  };

  function makeBuilder(table: string): any {
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      or: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      is: vi.fn(() => builder),
      update: vi.fn(() => builder),
      insert: vi.fn(() => builder),
      upsert: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(() => Promise.resolve(nextResult("single", table))),
      maybeSingle: vi.fn(() => Promise.resolve(nextResult("maybeSingle", table))),
      // Lets a chain be awaited directly with no terminal .single()/
      // .maybeSingle() call (e.g. `await admin.from(x).update(y).eq(z, w)`),
      // exactly like a real PostgREST query builder, which is itself a
      // thenable.
      then: (resolve: (v: MockResult) => void, reject: (e: unknown) => void) =>
        Promise.resolve(nextResult("await", table)).then(resolve, reject),
    };
    return builder;
  }

  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: vi.fn((name: string) => Promise.resolve(nextResult("rpc", name))),
  };

  return client;
}
