import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import styles from "./Input.module.scss";

type InputVariant = "default" | "otp";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  variant?: InputVariant;
  wrapperClassName?: string;
  endAction?: ReactNode;
  endActionClassName?: string;
};

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {
    variant = "default",
    className,
    wrapperClassName,
    endAction,
    endActionClassName,
    ...inputProps
  },
  ref,
) {
  if (variant === "otp") {
    return <input ref={ref} className={joinClasses(styles.otpInput, className)} {...inputProps} />;
  }

  return (
    <div className={joinClasses(styles.wrapper, wrapperClassName)}>
      <input ref={ref} className={joinClasses(styles.input, className)} {...inputProps} />
      {endAction && <div className={joinClasses(styles.endAction, endActionClassName)}>{endAction}</div>}
    </div>
  );
});
