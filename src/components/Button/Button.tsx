import { forwardRef, type ButtonHTMLAttributes } from "react";

import styles from "./Button.module.scss";

type ButtonVariant = "default" | "primary" | "link" | "icon" | "minimal";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "default", className, type = "button", ...buttonProps },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={joinClasses(styles.button, styles[variant], className)}
      {...buttonProps}
    />
  );
});
