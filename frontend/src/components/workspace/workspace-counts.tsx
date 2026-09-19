"use client";

import { createContext, useContext } from "react";
import { getDashboard, type CaseSummary } from "@/lib/api";
import { useLiveQuery } from "@/lib/use-live-query";

interface WorkspaceCountsValue {
  processing: number;
  pendingReviews: number;
  attentionItems: CaseSummary[];
  refresh: () => Promise<void>;
}
const WorkspaceCountsContext = createContext<WorkspaceCountsValue>({ processing: 0, pendingReviews: 0, attentionItems: [], refresh: async () => {} });
export function useWorkspaceCounts() { return useContext(WorkspaceCountsContext) }
export function WorkspaceCountsProvider({ children }: { children: React.ReactNode }) {
  const query = useLiveQuery((signal) => getDashboard("week", signal), []);
  const value = { processing: query.data?.metrics.processing ?? 0, pendingReviews: query.data?.metrics.unresolved ?? 0, attentionItems: query.data?.attention_items ?? [], refresh: query.refresh };
  return <WorkspaceCountsContext.Provider value={value}>{children}</WorkspaceCountsContext.Provider>;
}
