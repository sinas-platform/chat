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

export const THEME_PREFERENCES_KEY = "theme";
export const THEME_PREFERENCES_VISIBILITY = "private";
const THEME_PREFERENCE_DESCRIPTION = "User theme preference";
const THEME_PREFERENCE_TAGS = ["user", "preferences", "theme"] as const;
const THEME_PREFERENCE_RELEVANCE_SCORE = 1.0;

export type ThemeMode = "light" | "dark";

export type ThemePreferenceValue = {
  version: 1;
  theme: ThemeMode;
};

export const DEFAULT_THEME_PREFERENCE: ThemePreferenceValue = {
  version: 1,
  theme: "light",
};

export function normalizeThemePreferenceValue(value: unknown): ThemePreferenceValue {
  if (!value || typeof value !== "object") {
    return DEFAULT_THEME_PREFERENCE;
  }

  const record = value as Record<string, unknown>;
  const normalizedTheme = record.theme === "dark" || record.mode === "dark" ? "dark" : "light";

  return {
    version: 1,
    theme: normalizedTheme,
  };
}

export function useThemePreference() {
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
  const preferenceState = preferenceStatesByKey[THEME_PREFERENCES_KEY] ?? null;
  const preference = useMemo(() => normalizeThemePreferenceValue(preferenceState?.value), [preferenceState?.value]);

  const savePreferenceM = useMutation({
    mutationFn: async (nextPreference: ThemePreferenceValue) => {
      if (!canUsePreferencesState) {
        throw new Error("Not authenticated");
      }

      const normalizedValue = normalizeThemePreferenceValue(nextPreference);
      const payload = {
        value: normalizedValue,
        visibility: THEME_PREFERENCES_VISIBILITY,
        description: THEME_PREFERENCE_DESCRIPTION,
        tags: [...THEME_PREFERENCE_TAGS],
        relevance_score: THEME_PREFERENCE_RELEVANCE_SCORE,
        expires_at: null,
      };

      if (preferenceState) {
        return apiClient.updatePreferenceState(THEME_PREFERENCES_KEY, {
          ...payload,
        });
      }

      try {
        return await apiClient.createPreferenceState({
          key: THEME_PREFERENCES_KEY,
          ...payload,
        });
      } catch (error) {
        if (!isPreferenceAlreadyExistsError(error, THEME_PREFERENCES_KEY)) {
          throw error;
        }

        return apiClient.updatePreferenceState(THEME_PREFERENCES_KEY, payload);
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

  async function savePreference(nextPreference: ThemePreferenceValue) {
    savePreferenceM.reset();
    return savePreferenceM.mutateAsync(nextPreference);
  }

  const preferenceReadErrorMessage = useMemo(() => {
    if (!statesQuery.isError) return null;
    if (isPreferencePermissionError(statesQuery.error)) {
      return PREFERENCES_PERMISSION_ERROR;
    }
    return getPreferenceErrorMessage(statesQuery.error, "Could not load theme preference.");
  }, [statesQuery.error, statesQuery.isError]);

  const preferenceWriteErrorMessage = useMemo(() => {
    if (!savePreferenceM.isError) return null;
    if (isPreferencePermissionError(savePreferenceM.error)) {
      return PREFERENCES_PERMISSION_ERROR;
    }
    return getPreferenceErrorMessage(savePreferenceM.error, "Could not save theme preference.");
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
