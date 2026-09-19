"use client";

import { createContext, useContext, useMemo } from "react";
import { getDashboard } from "@/lib/api";
import { useLiveQuery } from "@/lib/use-live-query";

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
  unreadEmails: 0,
  pendingReviews: 0,
  markEmailRead: () => {},
  markReviewOpened: () => {},
  isEmailRead: () => true,
  isReviewOpened: () => false,
});

export function useWorkspaceCounts() {
  return useContext(WorkspaceCountsContext);
}

/**
 * Live shell counters. The Inbox badge represents cases still processing and the
 * Review badge represents unresolved review work. Opening a row does not create
 * a fake per-browser read state.
 */
export function WorkspaceCountsProvider({ children }: { children: React.ReactNode }) {
  const dashboard = useLiveQuery((signal) => getDashboard("week", signal), []);

  const value = useMemo<WorkspaceCountsValue>(
    () => ({
      unreadEmails: dashboard.data?.metrics.processing ?? 0,
      pendingReviews: dashboard.data?.metrics.unresolved ?? 0,
      markEmailRead: () => {},
      markReviewOpened: () => {},
      isEmailRead: () => true,
      isReviewOpened: () => false,
    }),
    [dashboard.data],
  );

  return (
    <WorkspaceCountsContext.Provider value={value}>{children}</WorkspaceCountsContext.Provider>
  );
}
