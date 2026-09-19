"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/** Badge counts shown in the sidebar when the session starts. */
const INITIAL_UNREAD_EMAILS = 12;
const INITIAL_PENDING_REVIEWS = 15;

interface WorkspaceCountsValue {
  unreadEmails: number;
  pendingReviews: number;
  /** Opening an email marks it read and drops the Inbox badge. */
  markEmailRead: (id: string) => void;
  /** Opening a review case takes it out of the Review Queue badge. */
  markReviewOpened: (id: string) => void;
  isEmailRead: (id: string) => boolean;
  isReviewOpened: (id: string) => boolean;
}

const WorkspaceCountsContext = createContext<WorkspaceCountsValue>({
  unreadEmails: INITIAL_UNREAD_EMAILS,
  pendingReviews: INITIAL_PENDING_REVIEWS,
  markEmailRead: () => {},
  markReviewOpened: () => {},
  isEmailRead: () => false,
  isReviewOpened: () => false,
});

export function useWorkspaceCounts() {
  return useContext(WorkspaceCountsContext);
}

/**
 * Tracks what the operator has already looked at, so the sidebar badges reflect
 * real progress through the queues instead of staying at a fixed number. Counts
 * are per session; they reset on reload.
 */
export function WorkspaceCountsProvider({ children }: { children: React.ReactNode }) {
  const [readEmails, setReadEmails] = useState<Set<string>>(() => new Set());
  const [openedReviews, setOpenedReviews] = useState<Set<string>>(() => new Set());

  const markEmailRead = useCallback((id: string) => {
    setReadEmails((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const markReviewOpened = useCallback((id: string) => {
    setOpenedReviews((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const value = useMemo<WorkspaceCountsValue>(
    () => ({
      unreadEmails: Math.max(0, INITIAL_UNREAD_EMAILS - readEmails.size),
      pendingReviews: Math.max(0, INITIAL_PENDING_REVIEWS - openedReviews.size),
      markEmailRead,
      markReviewOpened,
      isEmailRead: (id: string) => readEmails.has(id),
      isReviewOpened: (id: string) => openedReviews.has(id),
    }),
    [readEmails, openedReviews, markEmailRead, markReviewOpened],
  );

  return (
    <WorkspaceCountsContext.Provider value={value}>{children}</WorkspaceCountsContext.Provider>
  );
}
