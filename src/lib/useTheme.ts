import { createContext, useContext } from "react";

import type { ThemeMode } from "../hooks/useThemePreference";

export type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (nextTheme: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
  isSavingTheme: boolean;
  themeErrorMessage: string | null;
  clearThemeError: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
