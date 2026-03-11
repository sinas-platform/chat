import axios from "axios";

import type { PreferenceStateRecord } from "../types";

export const PREFERENCES_STORE_NAMESPACE = "default";
export const PREFERENCES_STORE_NAME = "preferences";
export const PREFERENCES_STORE_ID = `${PREFERENCES_STORE_NAMESPACE}/${PREFERENCES_STORE_NAME}`;
export const PREFERENCES_PERMISSION_ERROR = "Missing permissions to read/write preferences state";

export function filterPreferenceStatesForUser<TValue>(
  states: Array<PreferenceStateRecord<TValue>> | undefined,
  userId: string | null | undefined,
): Array<PreferenceStateRecord<TValue>> {
  if (!Array.isArray(states) || !userId) return [];
  return states.filter((state) => state.user_id === userId);
}

export function buildPreferenceStateMap<TValue>(
  states: Array<PreferenceStateRecord<TValue>> | undefined,
): Record<string, PreferenceStateRecord<TValue>> {
  if (!Array.isArray(states) || states.length === 0) return {};

  return states.reduce<Record<string, PreferenceStateRecord<TValue>>>((acc, state) => {
    acc[state.key] = state;
    return acc;
  }, {});
}

export function upsertPreferenceStateInList<TValue>(
  current: Array<PreferenceStateRecord<TValue>> | undefined,
  next: PreferenceStateRecord<TValue>,
): Array<PreferenceStateRecord<TValue>> {
  if (!Array.isArray(current) || current.length === 0) return [next];

  let replaced = false;
  const updated = current.map((state) => {
    if (state.key !== next.key || state.user_id !== next.user_id) return state;
    replaced = true;
    return next;
  });

  return replaced ? updated : [...updated, next];
}

function getHttpStatus(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  return error.response?.status ?? null;
}

export function isPreferencePermissionError(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 401 || status === 403;
}

export function getPreferenceErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  if (!error.response) {
    return `${fallback} Verify the backend route for ${PREFERENCES_STORE_ID} and your state permissions.`;
  }

  const data = error.response.data;
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object") {
    const detail = (data as Record<string, unknown>).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    const message = (data as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return error.message || fallback;
}

export function isPreferenceAlreadyExistsError(error: unknown, key: string): boolean {
  if (!axios.isAxiosError(error)) return false;

  const status = error.response?.status ?? null;
  const message = getPreferenceErrorMessage(error, "").toLowerCase();

  return (
    status === 409 ||
    message.includes(`state with key '${key.toLowerCase()}' already exists`) ||
    message.includes(`state with key "${key.toLowerCase()}" already exists`) ||
    message.includes("already exists")
  );
}
