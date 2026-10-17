"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `intervalMs` while the tab is visible.
 *
 * - Runs on a setTimeout chain rather than setInterval, so a slow request
 *   can never overlap the next one (server actions are also queued
 *   one-at-a-time per client by Next.js, so overlap would only back up
 *   user-initiated actions like sending a message).
 * - Pauses while the tab is hidden and fires once immediately on return,
 *   so a background tab costs nothing and catches up the moment you look.
 * - Does not fire on mount: callers already have server-rendered data.
 * - Errors from `callback` are swallowed; the next tick simply tries again.
 */
export function usePolling(
  callback: () => Promise<void> | void,
  intervalMs: number,
  enabled = true
) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clear = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = () => {
      clear();
      if (cancelled || document.hidden) return;
      timer = setTimeout(tick, intervalMs);
    };

    async function tick() {
      if (cancelled || running) return;
      running = true;
      try {
        await callbackRef.current();
      } catch {
        // Transient failure (offline, deploy in progress, ...): retry next tick.
      } finally {
        running = false;
        schedule();
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        clear();
      } else if (!running) {
        clear();
        void tick();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
