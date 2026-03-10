import axios from "axios";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { getWorkspaceUrl } from "../lib/workspace";
import type { RuntimeStateRecord } from "../types";

export const THEME_PREFERENCES_NAMESPACE = "preferences";
export const THEME_PREFERENCES_KEY = "theme";
export const THEME_PREFERENCES_VISIBILITY = "private";

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
  return {
    version: 1,
    theme: record.theme === "dark" ? "dark" : "light",
  };
}

function findThemeState(
  states: Array<RuntimeStateRecord<unknown>> | undefined,
): RuntimeStateRecord<unknown> | null {
  if (!Array.isArray(states)) return null;

  return (
    states.find((state) => state.namespace === THEME_PREFERENCES_NAMESPACE && state.key === THEME_PREFERENCES_KEY) ?? null
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

export function useThemePreference() {
  const queryClient = useQueryClient();
  const { token, loading: authLoading } = useAuth();
  const ws = getWorkspaceUrl();
  const hasWorkspaceUrl = ws.length > 0;
  const canUsePreferencesState = hasWorkspaceUrl && !authLoading && Boolean(token);
  const statesQueryKey = ["states", ws, THEME_PREFERENCES_NAMESPACE] as const;

  const statesQuery = useQuery({
    queryKey: statesQueryKey,
    queryFn: () => apiClient.listStates({ namespace: THEME_PREFERENCES_NAMESPACE }),
    enabled: canUsePreferencesState,
  });

  const preferenceState = useMemo(() => findThemeState(statesQuery.data), [statesQuery.data]);
  const preference = useMemo(() => normalizeThemePreferenceValue(preferenceState?.value), [preferenceState?.value]);

  const savePreferenceM = useMutation({
    mutationFn: async (nextPreference: ThemePreferenceValue) => {
      if (!canUsePreferencesState) {
        throw new Error("Not authenticated");
      }

      const normalizedValue = normalizeThemePreferenceValue(nextPreference);

      if (preferenceState?.id) {
        return apiClient.updateState(preferenceState.id, {
          value: normalizedValue,
          visibility: THEME_PREFERENCES_VISIBILITY,
        });
      }

      return apiClient.createState({
        namespace: THEME_PREFERENCES_NAMESPACE,
        key: THEME_PREFERENCES_KEY,
        value: normalizedValue,
        visibility: THEME_PREFERENCES_VISIBILITY,
        description: "User theme preference",
        tags: ["user", "preferences", "theme"],
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

  async function savePreference(nextPreference: ThemePreferenceValue) {
    savePreferenceM.reset();
    return savePreferenceM.mutateAsync(nextPreference);
  }

  const preferenceReadErrorMessage = useMemo(() => {
    if (!statesQuery.isError) return null;
    if (isPermissionError(statesQuery.error)) {
      return "Missing permissions to read/write preferences state";
    }
    return getErrorMessage(statesQuery.error, "Could not load theme preference.");
  }, [statesQuery.error, statesQuery.isError]);

  const preferenceWriteErrorMessage = useMemo(() => {
    if (!savePreferenceM.isError) return null;
    if (isPermissionError(savePreferenceM.error)) {
      return "Missing permissions to read/write preferences state";
    }
    return getErrorMessage(savePreferenceM.error, "Could not save theme preference.");
  }, [savePreferenceM.error, savePreferenceM.isError]);

  return {
    canUsePreferencesState,
    statesQuery,
    preference,
    hasStoredPreference: canUsePreferencesState && Boolean(preferenceState?.id),
    savePreference,
    isSavingPreference: savePreferenceM.isPending,
    resetSavePreferenceError: savePreferenceM.reset,
    preferenceReadErrorMessage,
    preferenceWriteErrorMessage,
  };
}
