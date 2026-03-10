import React, { useEffect, useState } from "react";

import {
  DEFAULT_THEME_PREFERENCE,
  useThemePreference,
  type ThemeMode,
} from "../hooks/useThemePreference";
import { ThemeContext, type ThemeContextValue } from "./useTheme";

const THEME_STORAGE_KEY = "chat.theme";

function readStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)?.trim();
    if (value === "dark") return "dark";
    if (value === "light") return "light";
  } catch {
    // Ignore storage failures and fallback to default.
  }

  return null;
}

function writeStoredTheme(theme: ThemeMode): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures.
  }
}

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

function getInitialTheme(): ThemeMode {
  const storedTheme = readStoredTheme() ?? DEFAULT_THEME_PREFERENCE.theme;
  applyTheme(storedTheme);
  return storedTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themePreference = useThemePreference();
  const [localTheme, setLocalThemeState] = useState<ThemeMode>(getInitialTheme);

  const persistedTheme =
    themePreference.canUsePreferencesState &&
    themePreference.statesQuery.isSuccess &&
    themePreference.hasStoredPreference
      ? themePreference.preference.theme
      : null;
  const theme: ThemeMode =
    themePreference.isSavingPreference || persistedTheme == null ? localTheme : persistedTheme;

  useEffect(() => {
    applyTheme(theme);
    writeStoredTheme(theme);
  }, [theme]);

  async function setTheme(nextTheme: ThemeMode): Promise<void> {
    themePreference.resetSavePreferenceError();
    setLocalThemeState(nextTheme);
    writeStoredTheme(nextTheme);

    if (!themePreference.canUsePreferencesState) return;

    try {
      await themePreference.savePreference({
        version: 1,
        theme: nextTheme,
      });
    } catch {
      // Keep local theme active even if preference save fails.
    }
  }

  async function toggleTheme(): Promise<void> {
    const nextTheme: ThemeMode = theme === "light" ? "dark" : "light";
    await setTheme(nextTheme);
  }

  const themeErrorMessage =
    themePreference.preferenceWriteErrorMessage ??
    themePreference.preferenceReadErrorMessage;

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme,
    isSavingTheme: themePreference.isSavingPreference,
    themeErrorMessage,
    clearThemeError: themePreference.resetSavePreferenceError,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
