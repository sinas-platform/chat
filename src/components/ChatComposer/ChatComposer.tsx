import { useEffect, useRef, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { Mic, MicOff } from "lucide-react";

import { useSpeechToText } from "../../lib/useSpeechToText";
import styles from "./ChatComposer.module.scss";

type ChatComposerProps = {
  value: string;
  onChange: (nextValue: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  textareaClassName?: string;
  textareaStyle?: CSSProperties;
  speechLang?: string;
};

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

function appendTranscript(currentValue: string, transcript: string): string {
  if (!currentValue.trim()) return transcript;
  return /\s$/.test(currentValue) ? `${currentValue}${transcript}` : `${currentValue} ${transcript}`;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder = "Type your message…",
  rows = 3,
  disabled = false,
  className,
  textareaClassName,
  textareaStyle,
  speechLang = "en-US",
}: ChatComposerProps) {
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  const {
    isSupported: isSpeechSupported,
    isListening,
    startListening,
    stopListening,
  } = useSpeechToText({
    lang: speechLang,
    onTranscript: (spokenText) => {
      onChange(appendTranscript(latestValueRef.current, spokenText));
    },
  });

  const isMicDisabled = disabled || !isSpeechSupported;
  const computedTextareaStyle: CSSProperties = { ...textareaStyle, paddingRight: "54px" };

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled || !value.trim()) return;
    onSubmit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (disabled || !value.trim()) return;
    onSubmit();
  }

  return (
    <form className={joinClasses(styles.root, className)} onSubmit={handleSubmit}>
      <textarea
        className={joinClasses(styles.textarea, textareaClassName)}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={rows}
        disabled={disabled}
        style={computedTextareaStyle}
      />
      <button
        type="button"
        className={joinClasses(styles.micButton, isListening && styles.micButtonActive)}
        onClick={isListening ? stopListening : startListening}
        disabled={isMicDisabled}
        aria-label={isListening ? "Stop voice input" : "Start voice input"}
        aria-pressed={isListening}
        title={isSpeechSupported ? "Voice input" : "Voice input is not supported in this browser"}
      >
        {isListening ? <MicOff size={16} /> : <Mic size={16} />}
      </button>
    </form>
  );
}
