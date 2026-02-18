import { useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./DropdownMenu.module.scss";

type DropdownVariant = "icon" | "text";
type DropdownAlign = "left" | "right";

export type DropdownMenuItem = {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type DropdownMenuProps = {
  items: DropdownMenuItem[];
  trigger: ReactNode;
  triggerAriaLabel: string;
  variant?: DropdownVariant;
  align?: DropdownAlign;
  menuClassName?: string;
};

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

export function DropdownMenu({
  items,
  trigger,
  triggerAriaLabel,
  variant = "icon",
  align = "right",
  menuClassName,
}: DropdownMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target || !rootRef.current) return;
      if (!rootRef.current.contains(target)) setIsOpen(false);
    }

    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [isOpen]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={joinClasses(styles.trigger, variant === "icon" ? styles.triggerIcon : styles.triggerText)}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={triggerAriaLabel}
      >
        {trigger}
      </button>

      {isOpen ? (
        <div
          className={joinClasses(
            styles.menu,
            align === "left" ? styles.menuLeft : styles.menuRight,
            menuClassName,
          )}
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={joinClasses(styles.item, item.danger && styles.itemDanger)}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                setIsOpen(false);
              }}
              disabled={item.disabled}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
