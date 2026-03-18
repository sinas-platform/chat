import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../lib/api";
import { useAuth } from "../lib/authContext";
import {
  buildPreferenceStateMap,
  filterPreferenceStatesForUser,
  getPreferenceErrorMessage,
  isPreferenceAlreadyExistsError,
  isPreferencePermissionError,
  PREFERENCES_PERMISSION_ERROR,
  PREFERENCES_STORE_ID,
  upsertPreferenceStateInList,
} from "../lib/preferenceStates";
import { getApplicationId, getWorkspaceUrl } from "../lib/workspace";
import type { AgentResponse, PreferenceStateRecord } from "../types";

export const VISIBLE_AGENTS_PREFERENCES_KEY = "visible_agents";
export const VISIBLE_AGENTS_PREFERENCES_VISIBILITY = "private";
const VISIBLE_AGENTS_PREFERENCE_DESCRIPTION = "Homepage agent visibility preferences";
const VISIBLE_AGENTS_PREFERENCE_TAGS = ["user", "preferences", "agents"] as const;
const VISIBLE_AGENTS_PREFERENCE_RELEVANCE_SCORE = 1.0;

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

function filterAgentsByPreference(
  agents: AgentResponse[],
  preference: VisibleAgentsPreferenceValue,
  preferenceUpdatedAt: string | null,
): AgentResponse[] {
  if (preference.mode === "all") return agents;

  const visibleRefs = new Set(preference.visibleAgentRefs);
  const preferenceUpdatedAtMs = preferenceUpdatedAt ? Date.parse(preferenceUpdatedAt) : Number.NaN;

  return agents.filter((agent) => {
    const agentRef = getAgentRef(agent);
    if (visibleRefs.has(agentRef)) return true;

    const agentCreatedAtMs = Date.parse(agent.created_at);
    if (Number.isNaN(preferenceUpdatedAtMs) || Number.isNaN(agentCreatedAtMs)) return false;

    // Agents created after the last saved preference should be visible by default.
    return agentCreatedAtMs > preferenceUpdatedAtMs;
  });
}

export function useVisibleAgentsPreference() {
  const queryClient = useQueryClient();
  const { token, user, loading: authLoading } = useAuth();
  const ws = getWorkspaceUrl();
  const appId = getApplicationId();
  const currentUserId = user?.id ?? null;
  const hasWorkspaceUrl = ws.length > 0;
  const canUsePreferencesState = hasWorkspaceUrl && !authLoading && Boolean(token) && Boolean(currentUserId);
  const statesQueryKey = ["preference-states", ws, PREFERENCES_STORE_ID, currentUserId ?? "anonymous"] as const;

  const agentsQuery = useQuery({
    queryKey: ["config-agents", ws, appId ?? ""],
    queryFn: () => apiClient.listAgents(appId),
    enabled: canUsePreferencesState,
  });

  const statesQuery = useQuery({
    queryKey: statesQueryKey,
    queryFn: async () => {
      const states = await apiClient.listPreferenceStates();
      return filterPreferenceStatesForUser(states, currentUserId);
    },
    enabled: canUsePreferencesState,
  });

  const preferenceStatesByKey = useMemo(
    () => buildPreferenceStateMap(statesQuery.data),
    [statesQuery.data],
  );
  const preferenceState = preferenceStatesByKey[VISIBLE_AGENTS_PREFERENCES_KEY] ?? null;
  const preference = useMemo(
    () => normalizeVisibleAgentsPreferenceValue(preferenceState?.value),
    [preferenceState?.value],
  );

  const activeAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => agent.is_active),
    [agentsQuery.data],
  );

  const visibleActiveAgents = useMemo(
    () => filterAgentsByPreference(activeAgents, preference, preferenceState?.updated_at ?? null),
    [activeAgents, preference, preferenceState?.updated_at],
  );

  const savePreferenceM = useMutation({
    mutationFn: async (nextPreference: VisibleAgentsPreferenceValue) => {
      if (!canUsePreferencesState) {
        throw new Error("Not authenticated");
      }

      const normalizedValue = normalizeVisibleAgentsPreferenceValue(nextPreference);
      const payload = {
        value: normalizedValue,
        visibility: VISIBLE_AGENTS_PREFERENCES_VISIBILITY,
        description: VISIBLE_AGENTS_PREFERENCE_DESCRIPTION,
        tags: [...VISIBLE_AGENTS_PREFERENCE_TAGS],
        relevance_score: VISIBLE_AGENTS_PREFERENCE_RELEVANCE_SCORE,
        expires_at: null,
      };

      if (preferenceState) {
        return apiClient.updatePreferenceState(VISIBLE_AGENTS_PREFERENCES_KEY, {
          ...payload,
        });
      }

      try {
        return await apiClient.createPreferenceState({
          key: VISIBLE_AGENTS_PREFERENCES_KEY,
          ...payload,
        });
      } catch (error) {
        if (!isPreferenceAlreadyExistsError(error, VISIBLE_AGENTS_PREFERENCES_KEY)) {
          throw error;
        }

        return apiClient.updatePreferenceState(VISIBLE_AGENTS_PREFERENCES_KEY, payload);
      }
    },
    onSuccess: (savedState) => {
      const nextState =
        savedState.user_id == null && currentUserId
          ? ({ ...savedState, user_id: currentUserId } as PreferenceStateRecord<unknown>)
          : (savedState as PreferenceStateRecord<unknown>);

      queryClient.setQueryData<Array<PreferenceStateRecord<unknown>>>(statesQueryKey, (current) =>
        upsertPreferenceStateInList(current, nextState),
      );
    },
  });

  async function savePreference(nextPreference: VisibleAgentsPreferenceValue) {
    savePreferenceM.reset();
    return savePreferenceM.mutateAsync(nextPreference);
  }

  const preferenceReadErrorMessage = useMemo(() => {
    if (!statesQuery.isError) return null;
    if (isPreferencePermissionError(statesQuery.error)) {
      return PREFERENCES_PERMISSION_ERROR;
    }
    return getPreferenceErrorMessage(statesQuery.error, "Could not load homepage agent preferences.");
  }, [statesQuery.error, statesQuery.isError]);

  const preferenceWriteErrorMessage = useMemo(() => {
    if (!savePreferenceM.isError) return null;
    if (isPreferencePermissionError(savePreferenceM.error)) {
      return PREFERENCES_PERMISSION_ERROR;
    }
    return getPreferenceErrorMessage(savePreferenceM.error, "Could not save homepage agent preferences.");
  }, [savePreferenceM.error, savePreferenceM.isError]);

  return {
    agentsQuery,
    statesQuery,
    activeAgents,
    visibleActiveAgents,
    preference,
    preferenceUpdatedAt: preferenceState?.updated_at ?? null,
    hasStoredPreference: Boolean(preferenceState),
    savePreference,
    isSavingPreference: savePreferenceM.isPending,
    resetSavePreferenceError: savePreferenceM.reset,
    preferenceReadErrorMessage,
    preferenceWriteErrorMessage,
  };
}
