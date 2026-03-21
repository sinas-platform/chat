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
import { getWorkspaceUrl } from "../lib/workspace";
import type { PreferenceStateRecord } from "../types";

export const ACTIVE_AGENT_PREFERENCES_KEY = "homepage_active_agent";
export const ACTIVE_AGENT_PREFERENCES_VISIBILITY = "private";
const ACTIVE_AGENT_PREFERENCE_DESCRIPTION = "Homepage active agent preference";
const ACTIVE_AGENT_PREFERENCE_TAGS = ["user", "preferences", "agents"] as const;
const ACTIVE_AGENT_PREFERENCE_RELEVANCE_SCORE = 1.0;

export type ActiveAgentPreferenceValue = {
  version: 1;
  agentId: string | null;
};

export const DEFAULT_ACTIVE_AGENT_PREFERENCE: ActiveAgentPreferenceValue = {
  version: 1,
  agentId: null,
};

export function normalizeActiveAgentPreferenceValue(value: unknown): ActiveAgentPreferenceValue {
  if (!value || typeof value !== "object") {
    return DEFAULT_ACTIVE_AGENT_PREFERENCE;
  }

  const record = value as Record<string, unknown>;
  const rawAgentId = record.agentId;
  const agentId = typeof rawAgentId === "string" && rawAgentId.trim().length > 0 ? rawAgentId.trim() : null;

  return {
    version: 1,
    agentId,
  };
}

export function useActiveAgentPreference() {
  const queryClient = useQueryClient();
  const { token, user, loading: authLoading } = useAuth();
  const ws = getWorkspaceUrl();
  const currentUserId = user?.id ?? null;
  const hasWorkspaceUrl = ws.length > 0;
  const canUsePreferencesState = hasWorkspaceUrl && !authLoading && Boolean(token) && Boolean(currentUserId);
  const statesQueryKey = ["preference-states", ws, PREFERENCES_STORE_ID, currentUserId ?? "anonymous"] as const;

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
  const preferenceState = preferenceStatesByKey[ACTIVE_AGENT_PREFERENCES_KEY] ?? null;
  const preference = useMemo(
    () => normalizeActiveAgentPreferenceValue(preferenceState?.value),
    [preferenceState?.value],
  );

  const savePreferenceM = useMutation({
    mutationFn: async (nextPreference: ActiveAgentPreferenceValue) => {
      if (!canUsePreferencesState) {
        throw new Error("Not authenticated");
      }

      const normalizedValue = normalizeActiveAgentPreferenceValue(nextPreference);
      const payload = {
        value: normalizedValue,
        visibility: ACTIVE_AGENT_PREFERENCES_VISIBILITY,
        description: ACTIVE_AGENT_PREFERENCE_DESCRIPTION,
        tags: [...ACTIVE_AGENT_PREFERENCE_TAGS],
        relevance_score: ACTIVE_AGENT_PREFERENCE_RELEVANCE_SCORE,
        expires_at: null,
      };

      if (preferenceState) {
        return apiClient.updatePreferenceState(ACTIVE_AGENT_PREFERENCES_KEY, {
          ...payload,
        });
      }

      try {
        return await apiClient.createPreferenceState({
          key: ACTIVE_AGENT_PREFERENCES_KEY,
          ...payload,
        });
      } catch (error) {
        if (!isPreferenceAlreadyExistsError(error, ACTIVE_AGENT_PREFERENCES_KEY)) {
          throw error;
        }

        return apiClient.updatePreferenceState(ACTIVE_AGENT_PREFERENCES_KEY, payload);
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

  async function savePreference(nextPreference: ActiveAgentPreferenceValue) {
    savePreferenceM.reset();
    return savePreferenceM.mutateAsync(nextPreference);
  }

  const preferenceReadErrorMessage = useMemo(() => {
    if (!statesQuery.isError) return null;
    if (isPreferencePermissionError(statesQuery.error)) {
      return PREFERENCES_PERMISSION_ERROR;
    }
    return getPreferenceErrorMessage(statesQuery.error, "Could not load active agent preference.");
  }, [statesQuery.error, statesQuery.isError]);

  const preferenceWriteErrorMessage = useMemo(() => {
    if (!savePreferenceM.isError) return null;
    if (isPreferencePermissionError(savePreferenceM.error)) {
      return PREFERENCES_PERMISSION_ERROR;
    }
    return getPreferenceErrorMessage(savePreferenceM.error, "Could not save active agent preference.");
  }, [savePreferenceM.error, savePreferenceM.isError]);

  return {
    canUsePreferencesState,
    statesQuery,
    preference,
    hasStoredPreference: canUsePreferencesState && Boolean(preferenceState),
    savePreference,
    isSavingPreference: savePreferenceM.isPending,
    resetSavePreferenceError: savePreferenceM.reset,
    preferenceReadErrorMessage,
    preferenceWriteErrorMessage,
  };
}
