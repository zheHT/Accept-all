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
  intervalMs: number | null = null,
): LiveQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef<boolean>(false);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    inFlight.current = true;
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
      if (!controller.signal.aborted) {
        setLoading(false);
        inFlight.current = false;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    void refresh();
    if (!intervalMs || intervalMs <= 0) {
      return () => {
        request.current?.abort();
      };
    }

    const poll = window.setInterval(() => {
      if (shouldPoll(document.visibilityState) && !inFlight.current) {
        void refresh();
      }
    }, intervalMs);

    return () => {
      request.current?.abort();
      window.clearInterval(poll);
    };
  }, [intervalMs, refresh]);

  return { data, loading, stale, error, refresh };
}
