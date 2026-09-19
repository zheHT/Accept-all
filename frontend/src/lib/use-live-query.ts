"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface LiveQuery<T> {
  data: T | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const shouldPoll = (visibilityState: DocumentVisibilityState) =>
  visibilityState === "visible";

export function useLiveQuery<T>(
  load: (signal: AbortSignal) => Promise<T>,
  dependencies: readonly unknown[] = [],
  intervalMs = 15_000,
): LiveQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading((current) => data === null || current);
    try {
      const next = await load(controller.signal);
      if (!controller.signal.aborted) {
        setData(next);
        setError(null);
        setStale(false);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "We could not load this view.");
        setStale(data !== null);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => {
      if (shouldPoll(document.visibilityState)) void refresh();
    }, intervalMs);
    const resume = () => {
      if (shouldPoll(document.visibilityState)) void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      request.current?.abort();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [intervalMs, refresh]);

  return { data, loading, stale, error, refresh };
}
