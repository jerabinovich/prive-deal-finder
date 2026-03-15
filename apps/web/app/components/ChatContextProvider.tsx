"use client";

import { createContext, useContext, useMemo, useState } from "react";

type PipelineRowSnapshot = {
  dealId?: string;
  dealKey?: string;
  name?: string;
  market?: string;
  assetType?: string;
  useCategory?: string;
  pipelineScore?: number | null;
  classification?: string;
  status?: string;
};

type IntegrationSnapshot = {
  source: string;
  status?: string;
  freshness?: string;
  coveragePct?: number | null;
  message?: string | null;
  lastSyncAt?: string | null;
};

type RunSnapshot = {
  id?: string;
  source?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string | null;
  runType?: string;
  severity?: string;
  metrics?: Record<string, unknown>;
};

export type ChatAppState = {
  route?: string;
  selectedDealId?: string | null;
  selectedDealKey?: string | null;
  activeFiltersCount?: number;
  activeFilters?: Record<string, unknown>;
  pipelineVisibleRange?: string | null;
  pipelineVisibleRows?: PipelineRowSnapshot[];
  integrationsSnapshot?: IntegrationSnapshot[];
  recentRuns?: RunSnapshot[];
};

type ChatContextValue = {
  appState: ChatAppState;
  publishState: (next: Partial<ChatAppState>) => void;
  clearState: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatContextProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<ChatAppState>({});

  const value = useMemo<ChatContextValue>(
    () => ({
      appState,
      publishState(next) {
        setAppState((previous) => ({
          ...previous,
          ...next,
        }));
      },
      clearState() {
        setAppState({});
      },
    }),
    [appState],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext() {
  const value = useContext(ChatContext);
  if (!value) {
    throw new Error("useChatContext must be used inside ChatContextProvider");
  }
  return value;
}

