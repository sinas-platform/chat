import type { ThemeMode } from "../../hooks/useThemePreference";
import { useTheme } from "../../lib/useTheme";
import styles from "./ThemeSwitch.module.scss";

function joinClasses(...classNames: Array<string | false>) {
  return classNames.filter(Boolean).join(" ");
}

type ThemeOption = {
  value: ThemeMode;
  label: string;
  iconClassName: string;
};

const THEME_OPTIONS: ThemeOption[] = [
  { value: "light", label: "LIGHT", iconClassName: styles.iconSun },
  { value: "dark", label: "DARK", iconClassName: styles.iconMoon },
];

export function ThemeSwitch() {
  const { theme, setTheme, isSavingTheme } = useTheme();

  function handleThemeSelect(nextTheme: ThemeMode) {
    if (nextTheme === theme || isSavingTheme) return;
    void setTheme(nextTheme);
  }

  return (
    <div className={styles.switch} role="group" aria-label="Theme switch">
      {THEME_OPTIONS.map((option) => {
        const isActive = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            className={joinClasses(
              styles.option,
              isActive ? styles.optionActive : styles.optionInactive,
            )}
            onClick={() => {
              handleThemeSelect(option.value);
            }}
            disabled={isSavingTheme}
            aria-pressed={isActive}
            aria-label={`Activate ${option.label.toLowerCase()} theme`}
          >
            <span className={joinClasses(styles.icon, option.iconClassName)} aria-hidden />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
