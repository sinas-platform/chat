import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import attachmentIcon from "../../icons/attachment.svg";
import microphoneIcon from "../../icons/microphone.svg";
import type { ChatAttachment } from "../../lib/files/types";
import { useSpeechToText } from "../../lib/useSpeechToText";
import { AttachmentChip } from "../AttachmentChip/AttachmentChip";
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
  attachments?: ChatAttachment[];
  isUploadingAttachment?: boolean;
  uploadingAttachmentName?: string | null;
  attachmentError?: string | null;
  onAddAttachment?: (file: File) => void | Promise<void>;
  onRemoveAttachment?: (index: number) => void;
  attachmentAccept?: string;
  uploadingAttachmentThumbnailUrl?: string | null;
  onStop?: () => void;
};

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

function appendTranscript(currentValue: string, transcript: string): string {
  if (!currentValue.trim()) return transcript;
  return /\s$/.test(currentValue) ? `${currentValue}${transcript}` : `${currentValue} ${transcript}`;
}

function hasFileDragData(event: DragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
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
  attachments = [],
  isUploadingAttachment = false,
  uploadingAttachmentName,
  attachmentError,
  onAddAttachment,
  onRemoveAttachment,
  attachmentAccept,
  uploadingAttachmentThumbnailUrl,
  onStop,
}: ChatComposerProps) {
  const latestValueRef = useRef(value);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDropActive, setIsDropActive] = useState(false);

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

  const canSubmit = !disabled && !isUploadingAttachment && (value.trim().length > 0 || attachments.length > 0);
  const isMicDisabled = disabled || !isSpeechSupported;
  const isAttachmentEnabled = typeof onAddAttachment === "function";
  const showStopButton = typeof onStop === "function";
  const hasAttachmentItems = attachments.length > 0 || isUploadingAttachment;
  const hasAttachmentMeta = hasAttachmentItems || Boolean(attachmentError);
  const computedTextareaStyle: CSSProperties = {
    ...textareaStyle,
    paddingRight: isAttachmentEnabled ? "94px" : "54px",
  };

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit();
  }

  function openAttachmentPicker() {
    if (!isAttachmentEnabled || disabled || isUploadingAttachment) return;
    attachmentInputRef.current?.click();
  }

  async function handleAttachmentSelection(e: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";

    if (!onAddAttachment || selectedFiles.length === 0) return;

    for (const file of selectedFiles) {
      await onAddAttachment(file);
    }
  }

  async function handleTextareaPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!isAttachmentEnabled || disabled || isUploadingAttachment || !onAddAttachment) return;

    const items = Array.from(e.clipboardData?.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file instanceof File);

    if (imageFiles.length === 0) return;

    // Prevent raw image/blob text insertion when using clipboard image paste.
    e.preventDefault();

    for (const file of imageFiles) {
      await onAddAttachment(file);
    }
  }

  function handleDragEnter(e: DragEvent<HTMLFormElement>) {
    if (!isAttachmentEnabled || disabled || isUploadingAttachment || !hasFileDragData(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDropActive(true);
  }

  function handleDragOver(e: DragEvent<HTMLFormElement>) {
    if (!isAttachmentEnabled || disabled || isUploadingAttachment || !hasFileDragData(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: DragEvent<HTMLFormElement>) {
    if (!isAttachmentEnabled || !hasFileDragData(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDropActive(false);
    }
  }

  async function handleDrop(e: DragEvent<HTMLFormElement>) {
    if (!isAttachmentEnabled || disabled || isUploadingAttachment || !onAddAttachment || !hasFileDragData(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDropActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files ?? []);
    if (droppedFiles.length === 0) return;

    for (const file of droppedFiles) {
      await onAddAttachment(file);
    }
  }

  return (
    <form
      className={joinClasses(styles.root, className, isDropActive && styles.dropActive)}
      onSubmit={handleSubmit}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDropActive ? (
        <div className={styles.dropOverlay} aria-hidden="true">
          <span className={styles.dropOverlayText}>Drop files to attach</span>
        </div>
      ) : null}

      {hasAttachmentMeta ? (
        <div className={joinClasses(styles.attachmentArea, hasAttachmentItems && styles.attachmentAreaWithItems)}>
          {hasAttachmentItems ? (
            <div className={styles.attachmentList}>
              {attachments.map((attachment, index) => (
                <AttachmentChip
                  key={`${attachment.name}-${attachment.uploaded_at}-${index}`}
                  name={attachment.name}
                  size={attachment.size}
                  thumbnailUrl={attachment.mime.toLowerCase().startsWith("image/") ? attachment.url : undefined}
                  onRemove={onRemoveAttachment ? () => onRemoveAttachment(index) : undefined}
                  disabled={disabled || isUploadingAttachment}
                />
              ))}

              {isUploadingAttachment ? (
                <AttachmentChip
                  name={uploadingAttachmentName || "Uploading file..."}
                  isUploading
                  thumbnailUrl={uploadingAttachmentThumbnailUrl || undefined}
                  disabled
                />
              ) : null}
            </div>
          ) : null}

          {attachmentError ? (
            <div className={styles.attachmentError} role="status" aria-live="polite">
              {attachmentError}
            </div>
          ) : null}
        </div>
      ) : null}

      <textarea
        className={joinClasses(styles.textarea, textareaClassName)}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handleTextareaPaste}
        rows={rows}
        disabled={disabled}
        style={computedTextareaStyle}
      />

      {isAttachmentEnabled ? (
        <>
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className={styles.attachmentInput}
            onChange={handleAttachmentSelection}
            accept={attachmentAccept}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            className={styles.attachmentButton}
            onClick={openAttachmentPicker}
            disabled={disabled || isUploadingAttachment}
            aria-label="Attach file"
            title="Attach file"
          >
            <img className={styles.attachmentIcon} src={attachmentIcon} alt="" aria-hidden />
          </button>
        </>
      ) : null}

      {showStopButton ? (
        <button
          type="button"
          className={joinClasses(styles.micButton, styles.stopButton)}
          onClick={onStop}
          aria-label="Stop generating response"
          title="Stop generating"
        >
          <span className={styles.stopGlyph} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className={joinClasses(styles.micButton, isListening && styles.micButtonActive)}
          onClick={isListening ? stopListening : startListening}
          disabled={isMicDisabled}
          aria-label={isListening ? "Stop voice input" : "Start voice input"}
          aria-pressed={isListening}
          title={isSpeechSupported ? "Voice input" : "Voice input is not supported in this browser"}
        >
          <img className={styles.micIcon} src={microphoneIcon} alt="" aria-hidden />
        </button>
      )}
    </form>
  );
}
