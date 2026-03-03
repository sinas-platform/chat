import axios from "axios";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { getApplicationId, getWorkspaceUrl } from "../lib/workspace";
import type { AgentResponse, RuntimeStateRecord } from "../types";

export const VISIBLE_AGENTS_PREFERENCES_NAMESPACE = "preferences";
export const VISIBLE_AGENTS_PREFERENCES_KEY = "visible_agents";
export const VISIBLE_AGENTS_PREFERENCES_VISIBILITY = "private";

export type VisibleAgentsPreferenceMode = "all" | "custom";

export type VisibleAgentsPreferenceValue = {
  version: 1;
  mode: VisibleAgentsPreferenceMode;
  visibleAgentRefs: string[];
};

export const DEFAULT_VISIBLE_AGENTS_PREFERENCE: VisibleAgentsPreferenceValue = {
  version: 1,
  mode: "all",
  visibleAgentRefs: [],
};

export function getAgentRef(agent: Pick<AgentResponse, "namespace" | "name">): string {
  return `${agent.namespace}/${agent.name}`;
}

function normalizeVisibleAgentRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const refs: string[] = [];

  value.forEach((item) => {
    if (typeof item !== "string") return;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    refs.push(trimmed);
  });

  return refs;
}

export function normalizeVisibleAgentsPreferenceValue(value: unknown): VisibleAgentsPreferenceValue {
  if (!value || typeof value !== "object") {
    return DEFAULT_VISIBLE_AGENTS_PREFERENCE;
  }

  const record = value as Record<string, unknown>;
  const mode = record.mode === "custom" ? "custom" : "all";

  return {
    version: 1,
    mode,
    visibleAgentRefs: normalizeVisibleAgentRefs(record.visibleAgentRefs),
  };
}

function findVisibleAgentsState(
  states: Array<RuntimeStateRecord<unknown>> | undefined,
): RuntimeStateRecord<unknown> | null {
  if (!Array.isArray(states)) return null;

  return (
    states.find(
      (state) =>
        state.namespace === VISIBLE_AGENTS_PREFERENCES_NAMESPACE && state.key === VISIBLE_AGENTS_PREFERENCES_KEY,
    ) ?? null
  );
}

function upsertStateInList<TValue>(
  current: Array<RuntimeStateRecord<TValue>> | undefined,
  next: RuntimeStateRecord<TValue>,
): Array<RuntimeStateRecord<TValue>> {
  if (!Array.isArray(current) || current.length === 0) return [next];

  let replaced = false;
  const updated = current.map((state) => {
    if (state.id !== next.id) return state;
    replaced = true;
    return next;
  });

  return replaced ? updated : [...updated, next];
}

function getHttpStatus(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  return error.response?.status ?? null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  const data = error.response?.data;
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object") {
    const detail = (data as Record<string, unknown>).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    const message = (data as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return error.message || fallback;
}

function isPermissionError(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 401 || status === 403;
}

function filterAgentsByPreference(
  agents: AgentResponse[],
  preference: VisibleAgentsPreferenceValue,
): AgentResponse[] {
  if (preference.mode === "all") return agents;

  const visibleRefs = new Set(preference.visibleAgentRefs);
  return agents.filter((agent) => visibleRefs.has(getAgentRef(agent)));
}

export function useVisibleAgentsPreference() {
  const queryClient = useQueryClient();
  const { token, loading: authLoading } = useAuth();
  const ws = getWorkspaceUrl();
  const appId = getApplicationId();
  const hasWorkspaceUrl = ws.length > 0;
  const canUsePreferencesState = hasWorkspaceUrl && !authLoading && Boolean(token);
  const statesQueryKey = ["states", ws, VISIBLE_AGENTS_PREFERENCES_NAMESPACE] as const;

  const agentsQuery = useQuery({
    queryKey: ["runtime-agents", ws, appId ?? ""],
    queryFn: () => apiClient.listAgents(appId),
    enabled: canUsePreferencesState,
  });

  const statesQuery = useQuery({
    queryKey: statesQueryKey,
    queryFn: () => apiClient.listStates({ namespace: VISIBLE_AGENTS_PREFERENCES_NAMESPACE }),
    enabled: canUsePreferencesState,
  });

  const preferenceState = useMemo(() => findVisibleAgentsState(statesQuery.data), [statesQuery.data]);
  const preference = useMemo(
    () => normalizeVisibleAgentsPreferenceValue(preferenceState?.value),
    [preferenceState?.value],
  );

  const activeAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => agent.is_active),
    [agentsQuery.data],
  );

  const visibleActiveAgents = useMemo(
    () => filterAgentsByPreference(activeAgents, preference),
    [activeAgents, preference],
  );

  const savePreferenceM = useMutation({
    mutationFn: async (nextPreference: VisibleAgentsPreferenceValue) => {
      if (!canUsePreferencesState) {
        throw new Error("Not authenticated");
      }

      const normalizedValue = normalizeVisibleAgentsPreferenceValue(nextPreference);

      if (preferenceState?.id) {
        return apiClient.updateState(preferenceState.id, {
          value: normalizedValue,
          visibility: VISIBLE_AGENTS_PREFERENCES_VISIBILITY,
        });
      }

      return apiClient.createState({
        namespace: VISIBLE_AGENTS_PREFERENCES_NAMESPACE,
        key: VISIBLE_AGENTS_PREFERENCES_KEY,
        value: normalizedValue,
        visibility: VISIBLE_AGENTS_PREFERENCES_VISIBILITY,
        description: "Homepage agent visibility preferences",
        tags: ["user", "preferences", "agents"],
        relevance_score: 1.0,
        expires_at: null,
      });
    },
    onSuccess: (savedState) => {
      queryClient.setQueryData<Array<RuntimeStateRecord<unknown>>>(statesQueryKey, (current) =>
        upsertStateInList(current, savedState as RuntimeStateRecord<unknown>),
      );
    },
  });

  async function savePreference(nextPreference: VisibleAgentsPreferenceValue) {
    savePreferenceM.reset();
    return savePreferenceM.mutateAsync(nextPreference);
  }

  const preferenceReadErrorMessage = useMemo(() => {
    if (!statesQuery.isError) return null;
    if (isPermissionError(statesQuery.error)) {
      return "Missing permissions to read/write preferences state";
    }
    return getErrorMessage(statesQuery.error, "Could not load homepage agent preferences.");
  }, [statesQuery.error, statesQuery.isError]);

  const preferenceWriteErrorMessage = useMemo(() => {
    if (!savePreferenceM.isError) return null;
    if (isPermissionError(savePreferenceM.error)) {
      return "Missing permissions to read/write preferences state";
    }
    return getErrorMessage(savePreferenceM.error, "Could not save homepage agent preferences.");
  }, [savePreferenceM.error, savePreferenceM.isError]);

  return {
    agentsQuery,
    statesQuery,
    activeAgents,
    visibleActiveAgents,
    preference,
    hasStoredPreference: Boolean(preferenceState?.id),
    preferenceStateId: preferenceState?.id ?? null,
    savePreference,
    isSavingPreference: savePreferenceM.isPending,
    resetSavePreferenceError: savePreferenceM.reset,
    preferenceReadErrorMessage,
    preferenceWriteErrorMessage,
  };
}
