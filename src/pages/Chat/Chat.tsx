import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CircleHelp, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./Chat.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { ChatComposer } from "../../components/ChatComposer/ChatComposer";
import SinasLoader from "../../components/Loader/Loader";
import { ThemeSwitch } from "../../components/ThemeSwitch/ThemeSwitch";
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import { useChatScrollBehavior } from "../../hooks/useChatScrollBehavior";
import { buildAgentPlaceholderMetaById, type AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import { apiClient, type ChatStreamHandle } from "../../lib/api";
import { uploadChatAttachment, UploadChatAttachmentError } from "../../lib/files/filesService";
import type { ChatAttachment } from "../../lib/files/types";
import type { AgentResponse, ApprovalRequiredEvent, ChatWithMessages, ToolEndEvent, ToolStartEvent } from "../../types";

type AudioAttachmentFormat = "wav" | "mp3" | "m4a" | "ogg";

type LocationState = {
  initialDraft?: string;
  initialAttachments?: ChatAttachment[];
};

type SendMessageVariables = {
  content: string | Array<Record<string, unknown>>;
  userTempId: string;
};

type ChatMessageViewModel = {
  id?: string | null;
  role?: string | null;
  content?: unknown;
  created_at?: string | null;
};

type ChatMessagesProps = {
  messages: ChatMessageViewModel[];
  isLoading: boolean;
  isError: boolean;
  isPending: boolean;
  isStreaming: boolean;
  streamingContent: string;
  thinkingText: string;
  toolRuns: ToolRun[];
  pendingApprovals: ApprovalRequiredEvent[];
  processingApproval: string | null;
  onApprovalDecision: (approval: ApprovalRequiredEvent, approved: boolean) => void;
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
  messagesContainerRef?: RefObject<HTMLDivElement | null>;
  onLastUserMessageRef?: (node: HTMLDivElement | null) => void;
};

type RenderedMessageAttachment = {
  kind: "image" | "file" | "audio";
  url?: string;
  name?: string;
  mime?: string;
  format?: AudioAttachmentFormat;
};

type ParsedMessageContent = {
  text: string;
  attachments: RenderedMessageAttachment[];
};

type ToolRunStatus = "running" | "done" | "error";

interface ToolRun {
  id: string;
  name: string;
  description: string;
  status: ToolRunStatus;
  startedAt: string;
  error?: string | null;
}

type ToolProgressRowsProps = {
  tools: ToolRun[];
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
};

const MARKDOWN_PLUGINS = [remarkGfm];
const MemoizedAppSidebar = memo(AppSidebar);
const DEFAULT_ATTACHMENT_ERROR = "File uploads aren’t configured on this Sinas instance. Ask admin to configure it.";
// Keep audio attachment plumbing in place; flip to `true` once agents support audio parts.
const AUDIO_ATTACHMENTS_ENABLED = false;
const AUDIO_ATTACHMENTS_DISABLED_ERROR = "Audio attachments are not supported yet.";
const UNSUPPORTED_AUDIO_ERROR = "Unsupported audio format. Please use WAV, MP3, M4A, or OGG.";
const SUPPORTED_AUDIO_FORMATS = new Set<AudioAttachmentFormat>(["wav", "mp3", "m4a", "ogg"]);
const CHAT_ATTACHMENT_ACCEPT = "image/*,.pdf,.doc,.docx,.txt";
const TOOL_RUN_AUTO_REMOVE_MS = 3000;
const CHAT_SCROLL_TOP_OFFSET = 16;
const CHAT_NEAR_BOTTOM_THRESHOLD = 72;

type PendingChatAttachment =
  | {
      kind: "uploaded";
      attachment: ChatAttachment;
    }
  | {
      kind: "audio";
      audio: {
        name: string;
        mime: string;
        size: number;
        format: AudioAttachmentFormat;
        base64: string;
        added_at: string;
      };
    };

function joinClasses(...classNames: Array<string | undefined | false>): string {
  return classNames.filter(Boolean).join(" ");
}

function getPlaceholderCssVars(placeholder: AgentPlaceholderMeta | undefined): CSSProperties | undefined {
  if (!placeholder) return undefined;

  return {
    "--agent-icon-color": placeholder.color,
    "--agent-icon-soft-color": placeholder.softColor,
  } as CSSProperties;
}

function getPlaceholderGlyphStyle(placeholder: AgentPlaceholderMeta | undefined): CSSProperties | undefined {
  if (!placeholder) return undefined;

  const iconUrl = `url("${placeholder.iconSrc}")`;
  return {
    WebkitMaskImage: iconUrl,
    maskImage: iconUrl,
  } as CSSProperties;
}

function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filename.length - 1) return "";
  return filename.slice(dotIndex + 1).toLowerCase();
}

function isAudioCandidate(file: File): boolean {
  if (file.type.toLowerCase().startsWith("audio/")) return true;
  return SUPPORTED_AUDIO_FORMATS.has(getFileExtension(file.name) as AudioAttachmentFormat);
}

function normalizeAudioFormat(file: File): AudioAttachmentFormat | null {
  const mime = file.type.toLowerCase();
  const ext = getFileExtension(file.name);

  if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
  if (mime === "audio/mp4" || mime === "audio/m4a" || mime === "audio/x-m4a") return "m4a";
  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav" || mime === "audio/vnd.wave") return "wav";
  if (mime === "audio/ogg" || mime === "application/ogg") return "ogg";

  if (ext === "mp3") return "mp3";
  if (ext === "m4a") return "m4a";
  if (ext === "wav") return "wav";
  if (ext === "ogg") return "ogg";

  return null;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read file data"));
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function stripDataUrlPrefix(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1 || commaIndex === dataUrl.length - 1) {
    throw new Error("Invalid file data");
  }
  return dataUrl.slice(commaIndex + 1);
}

function getAttachmentErrorMessage(error: unknown): string {
  if (error instanceof UploadChatAttachmentError) {
    if (error.code === "file_too_large") return "File is too large. Max size is 20 MB.";
    if (error.code === "no_permission") return "No permission to upload files";
    return DEFAULT_ATTACHMENT_ERROR;
  }

  return DEFAULT_ATTACHMENT_ERROR;
}

function getAudioAttachmentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not process audio file.";
}

function normalizeToolName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "tool";
}

function getToolDescription(description: string | null | undefined, toolName: string): string {
  const trimmed = description?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `Running ${toolName}`;
}

function getApprovalReason(approval: ApprovalRequiredEvent): string {
  const args = approval.arguments ?? {};
  const candidates = [
    args.justification,
    args.reason,
    args.description,
    args.message,
    args.purpose,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }

  return "The assistant needs your permission to continue with the next action.";
}

function extractToolCallId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const directId = (value as { tool_call_id?: unknown }).tool_call_id;
  if (typeof directId === "string" && directId.trim().length > 0) {
    return directId;
  }

  const nestedError = (value as { error?: unknown }).error;
  if (nestedError && typeof nestedError === "object") {
    const nestedId = (nestedError as { tool_call_id?: unknown }).tool_call_id;
    if (typeof nestedId === "string" && nestedId.trim().length > 0) {
      return nestedId;
    }
  }

  return null;
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value instanceof Error) {
    const trimmed = value.message.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === "object") {
    const directMessage = (value as { message?: unknown }).message;
    if (typeof directMessage === "string" && directMessage.trim().length > 0) {
      return directMessage.trim();
    }

    const directError = (value as { error?: unknown }).error;
    if (typeof directError === "string" && directError.trim().length > 0) {
      return directError.trim();
    }

    if (directError && typeof directError === "object") {
      const nestedMessage = (directError as { message?: unknown }).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
        return nestedMessage.trim();
      }
    }
  }

  return null;
}

function tryParseStructuredContentString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;

    const hasStructuredParts = parsed.some((item) => {
      if (!item || typeof item !== "object") return false;
      const type = (item as { type?: unknown }).type;
      return type === "text" || type === "image" || type === "file" || type === "audio";
    });

    return hasStructuredParts ? parsed : null;
  } catch {
    return null;
  }
}

function getMessageText(content: unknown): string {
  if (typeof content === "string") {
    const parsed = tryParseStructuredContentString(content);
    if (parsed) return getMessageText(parsed);
    return content;
  }
  if (content == null) return "";

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          if (typeof text === "string") return text;
        }
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      })
      .join("\n");
  }

  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || "Attachment";
  } catch {
    const segments = url.split("/").filter(Boolean);
    return segments[segments.length - 1] || "Attachment";
  }
}

function parseMessageContent(content: unknown): ParsedMessageContent {
  if (typeof content === "string") {
    const parsed = tryParseStructuredContentString(content);
    if (parsed) return parseMessageContent(parsed);
    return { text: content, attachments: [] };
  }

  if (content == null) {
    return { text: "", attachments: [] };
  }

  if (!Array.isArray(content)) {
    return { text: getMessageText(content), attachments: [] };
  }

  const textParts: string[] = [];
  const attachments: RenderedMessageAttachment[] = [];

  for (const item of content) {
    if (typeof item === "string") {
      textParts.push(item);
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }

    const part = item as Record<string, unknown>;
    const type = typeof part.type === "string" ? part.type : undefined;

    if (type === "text") {
      const text = part.text;
      if (typeof text === "string" && text.length > 0) {
        textParts.push(text);
      }
      continue;
    }

    if (type === "image") {
      const imageUrl = part.image;
      if (typeof imageUrl === "string" && imageUrl.length > 0) {
        attachments.push({
          kind: "image",
          url: imageUrl,
        });
      }
      continue;
    }

    if (type === "file") {
      const fileUrl = part.file;
      if (typeof fileUrl === "string" && fileUrl.length > 0) {
        attachments.push({
          kind: "file",
          url: fileUrl,
          name: typeof part.name === "string" ? part.name : getFilenameFromUrl(fileUrl),
          mime: typeof part.mime === "string" ? part.mime : undefined,
        });
      }
      continue;
    }

    if (type === "audio") {
      const format = typeof part.format === "string" ? part.format.toLowerCase() : "";
      if (SUPPORTED_AUDIO_FORMATS.has(format as AudioAttachmentFormat)) {
        attachments.push({
          kind: "audio",
          name: typeof part.name === "string" ? part.name : "Audio attachment",
          format: format as AudioAttachmentFormat,
        });
      } else {
        attachments.push({
          kind: "audio",
          name: "Audio attachment",
        });
      }
      continue;
    }

    const text = part.text;
    if (typeof text === "string" && text.length > 0) {
      textParts.push(text);
    }
  }

  return {
    text: textParts.join("\n"),
    attachments,
  };
}

function hasRenderableMessageContent(content: unknown): boolean {
  const parsed = parseMessageContent(content);
  return parsed.text.trim().length > 0 || parsed.attachments.length > 0;
}

function shouldRenderMessage(message: ChatMessageViewModel): boolean {
  if (message.role === "tool") return false;

  // Hide assistant tool-call scaffolding messages that have no visible text/attachments.
  if (message.role === "assistant" && !hasRenderableMessageContent(message.content)) {
    return false;
  }

  return true;
}

type ChatMessageRowProps = {
  message: ChatMessageViewModel;
  showAssistantAvatarLoading?: boolean;
  showAssistantAvatarPulse?: boolean;
  runningTool?: ToolRun;
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
  rowRef?: (node: HTMLDivElement | null) => void;
};

type MessageAttachmentImageProps = {
  attachment: RenderedMessageAttachment;
  compact: boolean;
};

function MessageAttachmentImage({ attachment, compact }: MessageAttachmentImageProps) {
  const [hasLoadError, setHasLoadError] = useState(false);

  if (hasLoadError) {
    return (
      <div
        className={`${styles.messageAttachmentImageFallback} ${
          compact ? styles.messageAttachmentImageFallbackCompact : ""
        }`}
        role="status"
        aria-label="Attached image preview unavailable"
      >
        <span className={styles.messageAttachmentImageFallbackTitle}>Image unavailable</span>
        <span className={styles.messageAttachmentImageFallbackText}>This preview link may have expired.</span>
      </div>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className={`${styles.messageAttachmentImageLink} ${compact ? styles.messageAttachmentImageLinkCompact : ""}`}
    >
      <img
        className={styles.messageAttachmentImage}
        src={attachment.url}
        alt="Attached image"
        loading="lazy"
        onError={() => setHasLoadError(true)}
      />
    </a>
  );
}

type AssistantAvatarProps = {
  showAssistantAvatarLoading?: boolean;
  showAssistantAvatarPulse?: boolean;
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
};

function AssistantAvatar({
  showAssistantAvatarLoading = false,
  showAssistantAvatarPulse = false,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
}: AssistantAvatarProps) {
  const assistantAvatarCssVars = getPlaceholderCssVars(assistantAvatarPlaceholder);
  const assistantAvatarGlyphStyle = getPlaceholderGlyphStyle(assistantAvatarPlaceholder);
  const shouldShowAssistantPlaceholder = !assistantAvatarSrc && Boolean(assistantAvatarCssVars);

  return (
    <div
      className={joinClasses(
        styles.assistantAvatar,
        showAssistantAvatarPulse && styles.assistantAvatarPulse,
        shouldShowAssistantPlaceholder && styles.assistantAvatarPlaceholder,
        assistantAvatarSrc && styles.assistantAvatarCustomIcon,
      )}
      style={assistantAvatarCssVars}
      role={showAssistantAvatarLoading ? "status" : undefined}
      aria-live={showAssistantAvatarLoading ? "polite" : undefined}
      aria-label={showAssistantAvatarLoading ? "Generating response" : undefined}
    >
      {assistantAvatarSrc ? (
        <img
          className={styles.assistantAvatarImage}
          src={assistantAvatarSrc}
          alt=""
          aria-hidden="true"
          onError={onAssistantAvatarError}
        />
      ) : shouldShowAssistantPlaceholder ? (
        <span className={styles.assistantAvatarPlaceholderGlyph} style={assistantAvatarGlyphStyle} />
      ) : (
        <Bot size={20} aria-hidden="true" />
      )}
    </div>
  );
}

type ApprovalPromptRowProps = {
  approval: ApprovalRequiredEvent;
  isProcessing: boolean;
  disableActions: boolean;
  onApprove: () => void;
  onReject: () => void;
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
};

const ApprovalPromptRow = memo(function ApprovalPromptRow({
  approval,
  isProcessing,
  disableActions,
  onApprove,
  onReject,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
}: ApprovalPromptRowProps) {
  return (
    <div className={`${styles.messageRow} ${styles.assistantRow}`}>
      <AssistantAvatar
        assistantAvatarSrc={assistantAvatarSrc}
        assistantAvatarPlaceholder={assistantAvatarPlaceholder}
        onAssistantAvatarError={onAssistantAvatarError}
      />

      <div className={`${styles.approvalCard} ${isProcessing ? styles.approvalCardProcessing : ""}`}>
        <div className={styles.approvalIconWrap}>
          {isProcessing ? (
            <Loader2 className={styles.approvalSpinner} aria-hidden="true" />
          ) : (
            <CircleHelp className={styles.approvalIcon} aria-hidden="true" />
          )}
        </div>

        <div className={styles.approvalContent}>
          <h4 className={styles.approvalTitle}>{isProcessing ? "Processing approval..." : "Action Needs Your Approval"}</h4>
          <p className={styles.approvalText}>{getApprovalReason(approval)}</p>
          <p className={styles.approvalHint}>Approve to continue, or reject to stop this action.</p>

          <div className={styles.approvalActions}>
            <button type="button" className={`${styles.approvalButton} ${styles.approveButton}`} onClick={onApprove} disabled={disableActions}>
              {isProcessing ? "Processing..." : "Approve"}
            </button>
            <button type="button" className={`${styles.approvalButton} ${styles.rejectButton}`} onClick={onReject} disabled={disableActions}>
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

ApprovalPromptRow.displayName = "ApprovalPromptRow";

const ToolProgressRows = memo(function ToolProgressRows({
  tools,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
}: ToolProgressRowsProps) {
  const visibleTools = tools.filter((tool) => tool.status !== "running");
  if (visibleTools.length === 0) return null;

  return (
    <div className={styles.toolProgressInlineList} role="status" aria-live="polite" aria-atomic="false">
      {visibleTools.map((tool) => {
        const isDone = tool.status === "done";
        const statusText = isDone ? "Completed" : "Failed";

        return (
          <div key={tool.id} className={`${styles.messageRow} ${styles.assistantRow}`}>
            <AssistantAvatar
              assistantAvatarSrc={assistantAvatarSrc}
              assistantAvatarPlaceholder={assistantAvatarPlaceholder}
              onAssistantAvatarError={onAssistantAvatarError}
            />

            <div
              className={joinClasses(
                styles.toolProgressCard,
                isDone && styles.toolProgressDone,
                tool.status === "error" && styles.toolProgressError
              )}
            >
              <span
                className={joinClasses(
                  styles.toolProgressDot,
                  isDone && styles.toolProgressDotDone,
                  tool.status === "error" && styles.toolProgressDotError
                )}
                aria-hidden="true"
              />
              <div className={styles.toolProgressContent}>
                <p className={styles.toolProgressDescription}>{tool.description}</p>
                <p className={styles.toolProgressMeta}>
                  <code className={styles.toolProgressName}>{tool.name}</code>
                  <span className={styles.toolProgressStatus}>{statusText}</span>
                </p>
                {tool.status === "error" && tool.error ? <p className={styles.toolProgressErrorText}>{tool.error}</p> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

ToolProgressRows.displayName = "ToolProgressRows";

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  showAssistantAvatarLoading = false,
  showAssistantAvatarPulse = false,
  runningTool,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
  rowRef,
}: ChatMessageRowProps) {
  const { text: messageText, attachments } = parseMessageContent(message.content);
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");
  const audioAttachments = attachments.filter((attachment) => attachment.kind === "audio");
  const useCompactImageAttachments = imageAttachments.length > 1;
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const shouldHideAssistantBubble = isAssistant && showAssistantAvatarLoading;
  const [openRunningToolId, setOpenRunningToolId] = useState<string | null>(null);
  const isRunningToolDetailsOpen = runningTool ? openRunningToolId === runningTool.id : false;

  const messageBubble = !shouldHideAssistantBubble ? (
    <div className={`${styles.message} ${isUser ? styles.userMsg : styles.assistantMsg}`}>
      <div className={styles.messageBody}>
        {isAssistant ? (
          <div className={styles.messageMarkdown}>
            <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{messageText}</ReactMarkdown>
          </div>
        ) : (
          <div className={styles.messageText}>{messageText}</div>
        )}

        {attachments.length > 0 ? (
          <div className={styles.messageAttachments}>
            {imageAttachments.length > 0 ? (
              <div
                className={`${styles.messageImageAttachments} ${
                  useCompactImageAttachments ? styles.messageImageAttachmentsCompact : ""
                }`}
              >
                {imageAttachments.map((attachment, index) => (
                  <MessageAttachmentImage
                    key={`${attachment.url}-${index}`}
                    attachment={attachment}
                    compact={useCompactImageAttachments}
                  />
                ))}
              </div>
            ) : null}

            {fileAttachments.length > 0 ? (
              <div className={styles.messageFileAttachments}>
                {fileAttachments.map((attachment, index) => (
                  <a
                    key={`${attachment.url}-${index}`}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.messageAttachmentFile}
                  >
                    <span className={styles.messageAttachmentFileName}>{attachment.name || "Attachment"}</span>
                    {attachment.mime ? (
                      <span className={styles.messageAttachmentFileMeta}>{attachment.mime}</span>
                    ) : null}
                  </a>
                ))}
              </div>
            ) : null}

            {audioAttachments.length > 0 ? (
              <div className={styles.messageFileAttachments}>
                {audioAttachments.map((attachment, index) => (
                  <div key={`${attachment.name ?? "audio"}-${attachment.format ?? "unknown"}-${index}`} className={styles.messageAttachmentFile}>
                    <span className={styles.messageAttachmentFileName}>{attachment.name || "Audio attachment"}</span>
                    <span className={styles.messageAttachmentFileMeta}>
                      {attachment.format ? `audio/${attachment.format}` : "audio"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className={`${styles.messageRow} ${isUser ? styles.userRow : styles.assistantRow}`} ref={rowRef}>
      {isAssistant ? (
        <AssistantAvatar
          showAssistantAvatarLoading={showAssistantAvatarLoading}
          showAssistantAvatarPulse={showAssistantAvatarPulse}
          assistantAvatarSrc={assistantAvatarSrc}
          assistantAvatarPlaceholder={assistantAvatarPlaceholder}
          onAssistantAvatarError={onAssistantAvatarError}
        />
      ) : null}

      {isAssistant ? (
        <div className={styles.assistantMessageStack}>
          {messageBubble ? (
            <div className={styles.assistantBubbleRow}>
              {messageBubble}
              {runningTool ? (
                <button
                  type="button"
                  className={styles.runningToolHelpButton}
                  aria-label={isRunningToolDetailsOpen ? "Hide running tool details" : "Show running tool details"}
                  aria-expanded={isRunningToolDetailsOpen}
                  onClick={() => setOpenRunningToolId((prev) => (prev === runningTool.id ? null : runningTool.id))}
                >
                  <CircleHelp className={styles.runningToolHelpIcon} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
          {runningTool && isRunningToolDetailsOpen ? (
            <div className={joinClasses(styles.toolProgressCard, styles.runningToolDetailsCard)}>
              <span className={joinClasses(styles.toolProgressDot, styles.runningToolDetailsDot)} aria-hidden="true" />
              <div className={styles.toolProgressContent}>
                <p className={styles.toolProgressDescription}>{runningTool.description}</p>
                <p className={styles.toolProgressMeta}>
                  <code className={styles.toolProgressName}>{runningTool.name}</code>
                  <span className={styles.toolProgressStatus}>Running</span>
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        messageBubble
      )}
    </div>
  );
});

ChatMessageRow.displayName = "ChatMessageRow";

const ChatMessages = memo(function ChatMessages({
  messages,
  isLoading,
  isError,
  isPending,
  isStreaming,
  streamingContent,
  thinkingText,
  toolRuns,
  pendingApprovals,
  processingApproval,
  onApprovalDecision,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
  messagesContainerRef,
  onLastUserMessageRef,
}: ChatMessagesProps) {
  const lastMessage = messages[messages.length - 1];
  const latestUserMessageIndex = [...messages].map((message) => message.role).lastIndexOf("user");
  const isWaitingForFirstChunk =
    isPending &&
    lastMessage?.role === "assistant" &&
    getMessageText(lastMessage.content).length === 0;
  const showStreamingRow = isStreaming || streamingContent.length > 0;
  const latestRunningTool = useMemo(() => [...toolRuns].reverse().find((tool) => tool.status === "running"), [toolRuns]);

  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const el = messagesContainerRef?.current;
    if (!el) return;
    const onScroll = () => setIsScrolled(el.scrollTop > 0);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [messagesContainerRef]);

  return (
    <div className={`${styles.messages} ${isScrolled ? styles.messagesScrolled : ""}`} ref={messagesContainerRef}>
      {isError ? <div className={styles.error}>Could not load chat</div> : null}

      {isLoading && messages.length === 0 ? (
        <div className={styles.loadingState} role="status" aria-live="polite">
          <SinasLoader size={28} />
          <span className={styles.loadingText}>Loading conversation...</span>
        </div>
      ) : messages.length === 0 && pendingApprovals.length === 0 ? (
        <div className={styles.empty}>No messages yet</div>
      ) : (
        messages.map((message, index) => {
          const isLastMessage = index === messages.length - 1;
          const shouldShowAssistantLoading =
            isWaitingForFirstChunk &&
            isLastMessage &&
            message.role === "assistant" &&
            getMessageText(message.content).length === 0;

          return (
            <ChatMessageRow
              key={message.id ?? `${message.role ?? "message"}-${message.created_at ?? "unknown"}-${index}`}
              message={message}
              showAssistantAvatarLoading={shouldShowAssistantLoading}
              showAssistantAvatarPulse={shouldShowAssistantLoading}
              assistantAvatarSrc={assistantAvatarSrc}
              assistantAvatarPlaceholder={assistantAvatarPlaceholder}
              onAssistantAvatarError={onAssistantAvatarError}
              rowRef={index === latestUserMessageIndex ? onLastUserMessageRef : undefined}
            />
          );
        })
      )}

      <ToolProgressRows
        tools={toolRuns}
        assistantAvatarSrc={assistantAvatarSrc}
        assistantAvatarPlaceholder={assistantAvatarPlaceholder}
        onAssistantAvatarError={onAssistantAvatarError}
      />

      {pendingApprovals.map((approval) => {
        const isProcessing = processingApproval === approval.tool_call_id;
        const disableActions = Boolean(processingApproval) || isStreaming;

        return (
          <ApprovalPromptRow
            key={approval.tool_call_id}
            approval={approval}
            isProcessing={isProcessing}
            disableActions={disableActions}
            onApprove={() => onApprovalDecision(approval, true)}
            onReject={() => onApprovalDecision(approval, false)}
            assistantAvatarSrc={assistantAvatarSrc}
            assistantAvatarPlaceholder={assistantAvatarPlaceholder}
            onAssistantAvatarError={onAssistantAvatarError}
          />
        );
      })}

      {showStreamingRow ? (
        <ChatMessageRow
          key="streaming-assistant"
          message={{
            id: "streaming-assistant",
            role: "assistant",
            content: streamingContent.length > 0 ? streamingContent : thinkingText,
            created_at: new Date().toISOString(),
          }}
          showAssistantAvatarLoading={isStreaming && streamingContent.length === 0 && !thinkingText}
          showAssistantAvatarPulse={isStreaming}
          runningTool={streamingContent.length === 0 ? latestRunningTool : undefined}
          assistantAvatarSrc={assistantAvatarSrc}
          assistantAvatarPlaceholder={assistantAvatarPlaceholder}
          onAssistantAvatarError={onAssistantAvatarError}
        />
      ) : null}

    </div>
  );
});

ChatMessages.displayName = "ChatMessages";

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const lastUserMessageRef = useRef<HTMLDivElement | null>(null);

  const initialDraft = useMemo(() => {
    const state = location.state as LocationState | null;
    return state?.initialDraft?.trim() ?? "";
  }, [location.state]);
  const initialAttachments = useMemo(() => {
    const state = location.state as LocationState | null;
    return Array.isArray(state?.initialAttachments) ? state.initialAttachments : [];
  }, [location.state]);

  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [uploadingAttachmentName, setUploadingAttachmentName] = useState<string | null>(null);
  const [uploadingAttachmentThumbnailUrl, setUploadingAttachmentThumbnailUrl] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [activeTools, setActiveTools] = useState<Record<string, ToolRun>>({});
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequiredEvent[]>([]);
  const [processingApproval, setProcessingApproval] = useState<string | null>(null);
  const sentInitialDraftRef = useRef<Record<string, boolean>>({});
  const streamHandleRef = useRef<ChatStreamHandle | null>(null);
  const toolCleanupTimeoutsRef = useRef<Record<string, number>>({});
  const composerAttachments = useMemo<ChatAttachment[]>(
    () =>
      pendingAttachments.map((item) => {
        if (item.kind === "uploaded") return item.attachment;

        return {
          name: item.audio.name,
          mime: item.audio.mime || `audio/${item.audio.format}`,
          size: item.audio.size,
          url: "",
          uploaded_at: item.audio.added_at,
        };
      }),
    [pendingAttachments]
  );

  const chatQ = useQuery({
    queryKey: ["chat", chatId],
    enabled: !!chatId,
    queryFn: async () => apiClient.getChat(chatId!),
  });
  const chatData = chatQ.data as ChatWithMessages | undefined;

  const chatAgentNamespace = chatData?.agent_namespace?.trim() ?? "";
  const chatAgentName = chatData?.agent_name?.trim() ?? "";
  const assistantAgentQ = useQuery({
    queryKey: ["chat-agent", chatAgentNamespace, chatAgentName],
    enabled: chatAgentNamespace.length > 0 && chatAgentName.length > 0,
    queryFn: () => apiClient.getAgent(chatAgentNamespace, chatAgentName),
  });
  const assistantAgent = assistantAgentQ.data as AgentResponse | undefined;
  const assistantAgentIconCandidates = useMemo(() => (assistantAgent ? [assistantAgent] : []), [assistantAgent]);
  const { iconSrcByAgentId, onAgentIconError } = useAgentIconSources(assistantAgentIconCandidates, apiClient);
  const assistantAvatarSrc = assistantAgent ? iconSrcByAgentId[assistantAgent.id] : undefined;
  const assistantAvatarPlaceholder = useMemo(() => {
    if (!chatAgentNamespace || !chatAgentName) return undefined;

    const placeholderAgentId =
      assistantAgent?.id ?? chatData?.agent_id ?? `${chatAgentNamespace.toLowerCase()}::${chatAgentName.toLowerCase()}`;
    const placeholderByAgentId = buildAgentPlaceholderMetaById([
      {
        id: placeholderAgentId,
        namespace: chatAgentNamespace,
        name: chatAgentName,
      },
    ]);

    return placeholderByAgentId[placeholderAgentId];
  }, [assistantAgent?.id, chatAgentName, chatAgentNamespace, chatData?.agent_id]);
  const onAssistantAvatarError = useMemo(() => {
    if (!assistantAgent) return undefined;

    return () => {
      void onAgentIconError(assistantAgent.id);
    };
  }, [assistantAgent, onAgentIconError]);

  const messages: ChatMessageViewModel[] = useMemo(() => {
    if (!chatData) return [];
    const rawMessages = Array.isArray(chatData.messages) ? (chatData.messages as ChatMessageViewModel[]) : [];
    return rawMessages.filter(shouldRenderMessage);
  }, [chatData]);
  const hasUserMessages = useMemo(() => {
    const rawMessages = Array.isArray(chatData?.messages) ? (chatData.messages as ChatMessageViewModel[]) : [];
    return rawMessages.some((message) => message.role === "user");
  }, [chatData]);
  const toolRuns = useMemo(() => {
    return Object.values(activeTools).sort((left, right) => {
      const rank = (status: ToolRunStatus): number => {
        if (status === "running") return 0;
        if (status === "error") return 1;
        return 2;
      };

      const rankDiff = rank(left.status) - rank(right.status);
      if (rankDiff !== 0) return rankDiff;
      return left.startedAt.localeCompare(right.startedAt);
    });
  }, [activeTools]);
  const thinkingText = useMemo(() => {
    const latestRunning = [...toolRuns].reverse().find((tool) => tool.status === "running");
    if (latestRunning?.description) return latestRunning.description;
    return "Thinking...";
  }, [toolRuns]);
  const userMessageCount = useMemo(() => messages.filter((message) => message.role === "user").length, [messages]);
  const hasRunningTool = useMemo(() => toolRuns.some((tool) => tool.status === "running"), [toolRuns]);
  const hasPendingApproval = pendingApprovals.length > 0;
  const { requestPinLatestUserMessage } = useChatScrollBehavior({
    chatId,
    scrollContainerRef: messagesContainerRef,
    lastUserMessageRef,
    messageCount: messages.length,
    userMessageCount,
    isStreaming,
    streamingContentLength: streamingContent.length,
    hasRunningTool,
    hasPendingApproval,
    topOffset: CHAT_SCROLL_TOP_OFFSET,
    nearBottomThreshold: CHAT_NEAR_BOTTOM_THRESHOLD,
  });

  const chatTitle = useMemo(() => {
    const rawTitle = chatData?.title;
    if (typeof rawTitle !== "string") return "Chat";

    const trimmedTitle = rawTitle.trim();
    return trimmedTitle || "Chat";
  }, [chatData]);

  useEffect(() => {
    document.title = `${chatTitle}`;
  }, [chatTitle]);

  function clearToolCleanupTimeout(toolCallId: string) {
    const timeoutId = toolCleanupTimeoutsRef.current[toolCallId];
    if (timeoutId == null) return;

    window.clearTimeout(timeoutId);
    delete toolCleanupTimeoutsRef.current[toolCallId];
  }

  function clearAllToolCleanupTimeouts() {
    Object.values(toolCleanupTimeoutsRef.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    toolCleanupTimeoutsRef.current = {};
  }

  function resetToolRuns() {
    clearAllToolCleanupTimeouts();
    setActiveTools({});
  }

  function handleToolStart(event: ToolStartEvent) {
    const now = new Date().toISOString();
    const toolName = normalizeToolName(event.name);

    clearToolCleanupTimeout(event.tool_call_id);
    setActiveTools((prev) => {
      const existing = prev[event.tool_call_id];
      const description = event.description?.trim() || existing?.description || getToolDescription(null, toolName);
      return {
        ...prev,
        [event.tool_call_id]: {
          id: event.tool_call_id,
          name: toolName,
          description,
          status: "running",
          startedAt: existing?.startedAt ?? now,
          error: null,
        },
      };
    });
  }

  function handleToolEnd(event: ToolEndEvent) {
    const now = new Date().toISOString();
    const toolName = normalizeToolName(event.name);

    clearToolCleanupTimeout(event.tool_call_id);
    setActiveTools((prev) => {
      const existing = prev[event.tool_call_id];
      const description = existing?.description ?? getToolDescription(null, toolName);

      return {
        ...prev,
        [event.tool_call_id]: {
          id: event.tool_call_id,
          name: existing?.name ?? toolName,
          description,
          status: "done",
          startedAt: existing?.startedAt ?? now,
          error: null,
        },
      };
    });
  }

  function handleToolError(error: unknown) {
    const now = new Date().toISOString();
    const toolCallId = extractToolCallId(error);
    const errorMessage = extractErrorMessage(error);

    if (toolCallId) {
      clearToolCleanupTimeout(toolCallId);
      setActiveTools((prev) => {
        const existing = prev[toolCallId];
        const toolName = normalizeToolName(existing?.name);
        return {
          ...prev,
          [toolCallId]: {
            id: toolCallId,
            name: toolName,
            description: existing?.description ?? getToolDescription(null, toolName),
            status: "error",
            startedAt: existing?.startedAt ?? now,
            error: errorMessage,
          },
        };
      });
      return;
    }

    setActiveTools((prev) => {
      let changed = false;
      const next: Record<string, ToolRun> = {};

      for (const [id, tool] of Object.entries(prev)) {
        if (tool.status === "running") {
          changed = true;
          next[id] = {
            ...tool,
            status: "error",
            error: errorMessage,
          };
        } else {
          next[id] = tool;
        }
      }

      return changed ? next : prev;
    });
  }

  function finalizeRunningTools(status: "done" | "error", errorMessage?: string | null) {
    setActiveTools((prev) => {
      let changed = false;
      const next: Record<string, ToolRun> = {};

      for (const [id, tool] of Object.entries(prev)) {
        if (tool.status !== "running") {
          next[id] = tool;
          continue;
        }

        changed = true;
        next[id] = {
          ...tool,
          status,
          ...(status === "error" ? { error: errorMessage ?? tool.error ?? "Stream error" } : { error: null }),
        };
      }

      return changed ? next : prev;
    });
  }

  useEffect(() => {
    return () => {
      if (uploadingAttachmentThumbnailUrl) {
        URL.revokeObjectURL(uploadingAttachmentThumbnailUrl);
      }
    };
  }, [uploadingAttachmentThumbnailUrl]);

  function replaceUploadingThumbnail(nextUrl: string | null) {
    setUploadingAttachmentThumbnailUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextUrl;
    });
  }

  function queueApproval(approval: ApprovalRequiredEvent) {
    setPendingApprovals((prev) => {
      if (prev.some((item) => item.tool_call_id === approval.tool_call_id)) {
        return prev;
      }
      return [...prev, approval];
    });
  }

  async function refreshChat() {
    if (!chatId) return;
    await queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
  }

  async function consumeActiveStream(handle: ChatStreamHandle) {
    streamHandleRef.current?.abort();
    streamHandleRef.current = handle;
    setIsStreaming(true);
    setStreamingContent("");

    try {
      await handle.done;
    } finally {
      if (streamHandleRef.current === handle) {
        streamHandleRef.current = null;
      }
      try {
        await refreshChat();
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
      }
    }
  }

  async function sendStreamingMessage(content: SendMessageVariables["content"]) {
    if (!chatId) return;

    resetToolRuns();
    const handle = apiClient.streamChatMessage(chatId, content, {
      onChunkContent: (text) => {
        setStreamingContent((prev) => prev + text);
      },
      onToolStart: (event) => {
        handleToolStart(event);
      },
      onToolEnd: (event) => {
        handleToolEnd(event);
      },
      onApprovalRequired: (approval) => {
        queueApproval(approval);
      },
      onDone: () => {
        finalizeRunningTools("done");
      },
      onError: (error) => {
        console.error("Streaming error:", error);
        handleToolError(error);
        finalizeRunningTools("error", extractErrorMessage(error));
      },
    });

    await consumeActiveStream(handle);
  }

  async function resumeApprovalStream(channelId: string) {
    if (!chatId) return;

    const handle = apiClient.streamChatChannel(chatId, channelId, {
      onChunkContent: (text) => {
        setStreamingContent((prev) => prev + text);
      },
      onToolStart: (event) => {
        handleToolStart(event);
      },
      onToolEnd: (event) => {
        handleToolEnd(event);
      },
      onApprovalRequired: (approval) => {
        queueApproval(approval);
      },
      onDone: () => {
        finalizeRunningTools("done");
      },
      onError: (error) => {
        console.error("Approval stream error:", error);
        handleToolError(error);
        finalizeRunningTools("error", extractErrorMessage(error));
      },
    });

    await consumeActiveStream(handle);
  }

  async function handleApproval(approval: ApprovalRequiredEvent, approved: boolean) {
    if (!chatId || isStreaming || processingApproval) return;

    setProcessingApproval(approval.tool_call_id);

    try {
      const channelId = await apiClient.approveToolCall(chatId, approval.tool_call_id, approved);
      setPendingApprovals((prev) => prev.filter((item) => item.tool_call_id !== approval.tool_call_id));
      await resumeApprovalStream(channelId);
    } catch (error) {
      console.error("Approval error:", error);
      setIsStreaming(false);
      setStreamingContent("");
      streamHandleRef.current = null;
      alert("Failed to process approval. Please try again.");
      await refreshChat();
    } finally {
      setProcessingApproval(null);
    }
  }

  function handleStop() {
    streamHandleRef.current?.abort();
  }

  const sendMsgM = useMutation({
    mutationFn: async (vars: SendMessageVariables) => {
      if (!chatId) throw new Error("Missing chatId");
      await sendStreamingMessage(vars.content);
    },
    onMutate: async (vars: SendMessageVariables) => {
      if (!chatId) return;

      await queryClient.cancelQueries({ queryKey: ["chat", chatId] });
      const previous = queryClient.getQueryData<any>(["chat", chatId]);

      queryClient.setQueryData(["chat", chatId], (old: any) => {
        if (!old) return old;
        const nextUserMsg: any = {
          id: vars.userTempId,
          role: "user",
          content: vars.content,
          created_at: new Date().toISOString(),
        };
        const oldMsgs = Array.isArray(old.messages) ? old.messages : [];
        return { ...old, messages: [...oldMsgs, nextUserMsg] };
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (!chatId) return;
      if (ctx?.previous) queryClient.setQueryData(["chat", chatId], ctx.previous);
    },
  });

  useEffect(() => {
    for (const [toolCallId, tool] of Object.entries(activeTools)) {
      if (tool.status === "running") {
        const timeoutId = toolCleanupTimeoutsRef.current[toolCallId];
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
          delete toolCleanupTimeoutsRef.current[toolCallId];
        }
        continue;
      }

      if (toolCleanupTimeoutsRef.current[toolCallId] == null) {
        toolCleanupTimeoutsRef.current[toolCallId] = window.setTimeout(() => {
          setActiveTools((prev) => {
            if (!prev[toolCallId]) return prev;
            const next = { ...prev };
            delete next[toolCallId];
            return next;
          });
          delete toolCleanupTimeoutsRef.current[toolCallId];
        }, TOOL_RUN_AUTO_REMOVE_MS);
      }
    }

    for (const toolCallId of Object.keys(toolCleanupTimeoutsRef.current)) {
      if (activeTools[toolCallId]) continue;

      window.clearTimeout(toolCleanupTimeoutsRef.current[toolCallId]);
      delete toolCleanupTimeoutsRef.current[toolCallId];
    }
  }, [activeTools]);

  useEffect(() => {
    return () => {
      streamHandleRef.current?.abort();
      streamHandleRef.current = null;
      Object.values(toolCleanupTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      toolCleanupTimeoutsRef.current = {};
    };
  }, []);

  useEffect(() => {
    streamHandleRef.current?.abort();
    streamHandleRef.current = null;
    setIsStreaming(false);
    setStreamingContent("");
    clearAllToolCleanupTimeouts();
    setActiveTools({});
    setPendingApprovals([]);
    setProcessingApproval(null);
  }, [chatId]);

  // Auto-send initial draft once
  useEffect(() => {
    if (!chatId) return;
    if (!initialDraft && initialAttachments.length === 0) return;
    if (chatQ.isLoading || chatQ.isError) return;
    if (hasUserMessages) {
      sentInitialDraftRef.current[chatId] = true;
      return;
    }

    if (sentInitialDraftRef.current[chatId]) return;
    sentInitialDraftRef.current[chatId] = true;

    const ts = Date.now();
    requestPinLatestUserMessage();
    sendMsgM.mutate({
      content:
        initialAttachments.length > 0
          ? [
              ...(initialDraft ? [{ type: "text", text: initialDraft }] : []),
              ...initialAttachments.map((attachment) => ({
                type: attachment.mime.toLowerCase().startsWith("image/") ? "image" : "file",
                ...(attachment.mime.toLowerCase().startsWith("image/")
                  ? { image: attachment.url }
                  : { file: attachment.url, name: attachment.name, mime: attachment.mime }),
              })),
            ]
          : initialDraft,
      userTempId: `tmp-user-${ts}`,
    });
  }, [chatId, initialDraft, initialAttachments, chatQ.isLoading, chatQ.isError, hasUserMessages, requestPinLatestUserMessage, sendMsgM]);

  async function addAttachment(file: File) {
    if (!chatId || isUploadingAttachment || sendMsgM.isPending || isStreaming || pendingApprovals.length > 0) return;

    setAttachmentError(null);
    setIsUploadingAttachment(true);
    setUploadingAttachmentName(file.name);
    replaceUploadingThumbnail(file.type.toLowerCase().startsWith("image/") ? URL.createObjectURL(file) : null);

    try {
      if (isAudioCandidate(file)) {
        if (!AUDIO_ATTACHMENTS_ENABLED) {
          setAttachmentError(AUDIO_ATTACHMENTS_DISABLED_ERROR);
          return;
        }

        const format = normalizeAudioFormat(file);
        if (!format) {
          setAttachmentError(UNSUPPORTED_AUDIO_ERROR);
          return;
        }

        const dataUrl = await fileToDataUrl(file);
        const base64 = stripDataUrlPrefix(dataUrl);

        setPendingAttachments((prev) => [
          ...prev,
          {
            kind: "audio",
            audio: {
              name: file.name,
              mime: file.type || `audio/${format}`,
              size: file.size,
              format,
              base64,
              added_at: new Date().toISOString(),
            },
          },
        ]);
        return;
      }

      const uploadedAttachment = await uploadChatAttachment(file, chatId);
      setPendingAttachments((prev) => [...prev, { kind: "uploaded", attachment: uploadedAttachment }]);
    } catch (error) {
      const isAudioFile = isAudioCandidate(file);
      setAttachmentError(isAudioFile ? getAudioAttachmentErrorMessage(error) : getAttachmentErrorMessage(error));
    } finally {
      setIsUploadingAttachment(false);
      setUploadingAttachmentName(null);
      replaceUploadingThumbnail(null);
    }
  }

  function removeAttachment(indexToRemove: number) {
    setAttachmentError(null);
    setPendingAttachments((prev) => prev.filter((_, index) => index !== indexToRemove));
  }

  function submitInput() {
    const trimmed = input.trim();
    if (sendMsgM.isPending || isUploadingAttachment || isStreaming || processingApproval || pendingApprovals.length > 0) return;
    if (!trimmed && pendingAttachments.length === 0) return;

    const content =
      pendingAttachments.length === 0
        ? trimmed
        : [
            ...(trimmed ? [{ type: "text", text: trimmed }] : []),
            ...pendingAttachments.map((item) => {
              if (item.kind === "audio") {
                return {
                  type: "audio",
                  data: item.audio.base64,
                  format: item.audio.format,
                };
              }

              const attachment = item.attachment;
              return attachment.mime.toLowerCase().startsWith("image/")
                ? ({ type: "image", image: attachment.url } as const)
                : ({ type: "file", file: attachment.url, name: attachment.name, mime: attachment.mime } as const);
            }),
          ];

    const ts = Date.now();
    requestPinLatestUserMessage();
    sendMsgM.mutate({
      content,
      userTempId: `tmp-user-${ts}`,
    });
    setInput("");
    setPendingAttachments([]);
    setAttachmentError(null);
  }

  if (!chatId) {
    return (
      <div className={styles.layout}>
        <MemoizedAppSidebar />
        <main className={styles.main}>
          <ThemeSwitch className={styles.themeSwitch} />

          <div className={styles.chatShell}>
            <p>Missing chat id</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <MemoizedAppSidebar activeChatId={chatId} />
      <main className={styles.main}>
        <ThemeSwitch className={styles.themeSwitch} />

        <div className={styles.chatShell}>
          <ChatMessages
            messages={messages}
            isLoading={chatQ.isLoading}
            isError={chatQ.isError}
            isPending={sendMsgM.isPending}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            thinkingText={thinkingText}
            toolRuns={toolRuns}
            pendingApprovals={pendingApprovals}
            processingApproval={processingApproval}
            onApprovalDecision={(approval, approved) => {
              void handleApproval(approval, approved);
            }}
            assistantAvatarSrc={assistantAvatarSrc}
            assistantAvatarPlaceholder={assistantAvatarPlaceholder}
            onAssistantAvatarError={onAssistantAvatarError}
            messagesContainerRef={messagesContainerRef}
            onLastUserMessageRef={(node) => {
              lastUserMessageRef.current = node;
            }}
          />

          <ChatComposer
            className={styles.composer}
            textareaClassName={styles.input}
            placeholder="Ask something…"
            value={input}
            onChange={setInput}
            onSubmit={submitInput}
            rows={4}
            disabled={sendMsgM.isPending || isStreaming || Boolean(processingApproval) || pendingApprovals.length > 0}
            attachments={composerAttachments}
            isUploadingAttachment={isUploadingAttachment}
            uploadingAttachmentName={uploadingAttachmentName}
            uploadingAttachmentThumbnailUrl={uploadingAttachmentThumbnailUrl}
            attachmentError={attachmentError}
            onAddAttachment={addAttachment}
            onRemoveAttachment={removeAttachment}
            attachmentAccept={CHAT_ATTACHMENT_ACCEPT}
            onStop={isStreaming ? handleStop : undefined}
          />
        </div>
      </main>
    </div>
  );
}
