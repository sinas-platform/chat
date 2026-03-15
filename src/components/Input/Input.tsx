import { forwardRef, useRef, type ForwardedRef, type InputHTMLAttributes, type ReactNode } from "react";

import CrossIcon from "../../icons/cross.svg?react";
import styles from "./Input.module.scss";

type InputVariant = "default" | "otp";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  variant?: InputVariant;
  wrapperClassName?: string;
  startAction?: ReactNode;
  startActionClassName?: string;
  endAction?: ReactNode;
  endActionClassName?: string;
};

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {
    variant = "default",
    className,
    wrapperClassName,
    startAction,
    startActionClassName,
    endAction,
    endActionClassName,
    ...inputProps
  },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (variant === "otp") {
    return <input ref={ref} className={joinClasses(styles.otpInput, className)} {...inputProps} />;
  }

  const isSearchInput = inputProps.type === "search";
  const showSearchClearAction =
    isSearchInput && !endAction && typeof inputProps.value === "string" && inputProps.value.length > 0;

  function setInputRefs(node: HTMLInputElement | null) {
    inputRef.current = node;
    assignRef(ref, node);
  }

  function clearSearchValue() {
    const inputElement = inputRef.current;
    if (!inputElement || inputProps.disabled || inputProps.readOnly) return;

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (valueSetter) {
      valueSetter.call(inputElement, "");
    } else {
      inputElement.value = "";
    }

    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    inputElement.focus();
  }

  return (
    <div className={joinClasses(styles.wrapper, wrapperClassName)}>
      {startAction && <div className={joinClasses(styles.startAction, startActionClassName)}>{startAction}</div>}
      <input ref={setInputRefs} className={joinClasses(styles.input, className)} {...inputProps} />
      {showSearchClearAction ? (
        <button
          type="button"
          className={styles.searchClearButton}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearSearchValue}
          aria-label="Clear search"
          disabled={inputProps.disabled || inputProps.readOnly}
        >
          <CrossIcon className={styles.searchClearIcon} aria-hidden />
        </button>
      ) : null}
      {endAction && <div className={joinClasses(styles.endAction, endActionClassName)}>{endAction}</div>}
    </div>
  );
});
