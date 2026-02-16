import { useMemo, useRef } from "react";
import { Input } from "../../components/Input/Input.tsx";
import styles from "./OTPInput.module.scss";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function OTPInput({ value, onChange, disabled }: Props) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const digits = useMemo(() => {
    const clean = value.replace(/\D/g, "").slice(0, 6);
    return Array.from({ length: 6 }, (_, i) => clean[i] ?? "");
  }, [value]);

  const setDigit = (index: number, next: string) => {
    const cleanDigit = next.replace(/\D/g, "").slice(-1);
    const current = value.replace(/\D/g, "").slice(0, 6).split("");
    current[index] = cleanDigit;
    const newValue = current.join("").slice(0, 6);
    onChange(newValue);

    if (cleanDigit && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const clean = value.replace(/\D/g, "").slice(0, 6);
      if (digits[index]) {
        const arr = clean.split("");
        arr[index] = "";
        onChange(arr.join("").slice(0, 6));
      } else if (index > 0) {
        inputsRef.current[index - 1]?.focus();
        const arr = clean.split("");
        arr[index - 1] = "";
        onChange(arr.join("").slice(0, 6));
      }
    }

    if (e.key === "ArrowLeft" && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const txt = e.clipboardData.getData("text");
    const clean = txt.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    inputsRef.current[Math.min(clean.length, 5)]?.focus();
  };

  return (
    <div className={styles.otp}>
      {digits.map((d, i) => (
        <Input
          key={i}
          variant="otp"
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          value={d}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}
