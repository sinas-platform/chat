import { memo, useEffect, useMemo, useState, type RefObject } from "react";
import { Bot, CircleHelp, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./Chat.module.scss";
import SinasLoader from "../../components/Loader/Loader";
import type { AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import type { ApprovalRequiredEvent } from "../../types";
import {
  getApprovalReason,
  getMessageText,
  getPlaceholderCssVars,
  getPlaceholderGlyphStyle,
  getSinasComponentRenderSrc,
  joinClasses,
  parseMessageContent,
  parseSinasComponentToolPayload,
  type ChatMessageViewModel,
  type RenderedMessageAttachment,
  type SinasComponentToolPayload,
  type ToolRun,
} from "./chatUtils";

const MARKDOWN_PLUGINS = [remarkGfm];

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

type ComponentFrameProps = {
  payload: SinasComponentToolPayload;
};

function ComponentFrame({ payload }: ComponentFrameProps) {
  const title = payload.title?.trim() || "Component";
  const componentName = `${payload.namespace}/${payload.name}`;
  const status = payload.compile_status?.trim();

  return (
    <div className={styles.componentToolCard}>
      <div className={styles.componentToolCardHeader}>
        <p className={styles.componentToolCardTitle}>{title}</p>
        <div className={styles.componentToolCardMeta}>
          <code className={styles.componentToolCardName}>{componentName}</code>
          {status ? <span className={styles.componentToolCardStatus}>{status}</span> : null}
        </div>
      </div>

      <iframe
        className={styles.componentToolFrame}
        title={title}
        src={getSinasComponentRenderSrc(payload)}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
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
          <h4 className={styles.approvalTitle}>{isProcessing ? "Processing your decision..." : "Please confirm this action"}</h4>
          <p className={styles.approvalText}>{getApprovalReason(approval)}</p>
          <p className={styles.approvalHint}>Approve to continue, or reject to stop this step.</p>

          <div className={styles.approvalActions}>
            <button
              type="button"
              className={`${styles.approvalButton} ${styles.approveButton}`}
              onClick={onApprove}
              disabled={disableActions}
            >
              {isProcessing ? "Processing..." : "Approve"}
            </button>
            <button
              type="button"
              className={`${styles.approvalButton} ${styles.rejectButton}`}
              onClick={onReject}
              disabled={disableActions}
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

ApprovalPromptRow.displayName = "ApprovalPromptRow";

type ToolProgressRowsProps = {
  tools: ToolRun[];
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
};

const ToolProgressRows = memo(function ToolProgressRows({
  tools,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
}: ToolProgressRowsProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const completedTools = tools.filter((tool) => tool.status !== "running");

  if (completedTools.length === 0) return null;

  const completedCount = completedTools.filter((tool) => tool.status === "done").length;
  const failedCount = completedTools.filter((tool) => tool.status === "error").length;
  const summaryText =
    failedCount === 0
      ? `${completedTools.length} background ${completedTools.length === 1 ? "step" : "steps"} completed.`
      : `${completedCount} completed, ${failedCount} ${failedCount === 1 ? "had an issue" : "had issues"}.`;

  return (
    <div className={styles.toolProgressInlineList}>
      <div className={`${styles.messageRow} ${styles.assistantRow}`}>
        <AssistantAvatar
          assistantAvatarSrc={assistantAvatarSrc}
          assistantAvatarPlaceholder={assistantAvatarPlaceholder}
          onAssistantAvatarError={onAssistantAvatarError}
        />

        <div
          className={joinClasses(
            styles.toolActivitySummaryCard,
            failedCount > 0 && styles.toolActivitySummaryCardError,
            isDetailsOpen && styles.toolActivitySummaryCardExpanded,
          )}
          role="status"
          aria-live="polite"
          aria-atomic="false"
        >
          <div className={styles.toolActivitySummaryHeader}>
            <div className={styles.toolActivitySummaryContent}>
              <p className={styles.toolActivitySummaryTitle}>Background activity</p>
              <p className={styles.toolActivitySummaryText}>{summaryText}</p>
            </div>

            <button
              type="button"
              className={styles.toolActivityInfoButton}
              aria-label={isDetailsOpen ? "Hide background activity details" : "Show background activity details"}
              aria-expanded={isDetailsOpen}
              onClick={() => setIsDetailsOpen((prev) => !prev)}
            >
              <CircleHelp className={styles.toolActivityInfoIcon} aria-hidden="true" />
              <span>{isDetailsOpen ? "Hide details" : "Details"}</span>
            </button>
          </div>

          {isDetailsOpen ? (
            <div className={styles.toolActivityDetailsList}>
              {completedTools.map((tool) => {
                const isDone = tool.status === "done";
                const statusText = isDone ? "Completed" : "Failed";

                return (
                  <div
                    key={tool.id}
                    className={joinClasses(
                      styles.toolProgressCard,
                      styles.toolActivityDetailsCard,
                      isDone && styles.toolProgressDone,
                      tool.status === "error" && styles.toolProgressError,
                    )}
                  >
                    <span
                      className={joinClasses(
                        styles.toolProgressDot,
                        isDone && styles.toolProgressDotDone,
                        tool.status === "error" && styles.toolProgressDotError,
                      )}
                      aria-hidden="true"
                    />
                    <div className={styles.toolProgressContent}>
                      <p className={styles.toolProgressDescription}>{tool.description}</p>
                      <p className={styles.toolProgressMeta}>
                        <code className={styles.toolProgressName}>{tool.name}</code>
                        <span className={styles.toolProgressStatus}>{statusText}</span>
                      </p>
                      {tool.status === "error" && tool.error ? (
                        <p className={styles.toolProgressErrorText}>{tool.error}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
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
  const componentPayload = parseSinasComponentToolPayload(message.content);
  const isComponentToolMessage = message.role === "tool" && componentPayload !== null;
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");
  const audioAttachments = attachments.filter((attachment) => attachment.kind === "audio");
  const useCompactImageAttachments = imageAttachments.length > 1;
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant" || isComponentToolMessage;
  const shouldHideAssistantBubble = isAssistant && showAssistantAvatarLoading;
  const [openRunningToolId, setOpenRunningToolId] = useState<string | null>(null);
  const isRunningToolDetailsOpen = runningTool ? openRunningToolId === runningTool.id : false;

  const messageBubble = !shouldHideAssistantBubble ? (
    <div className={`${styles.message} ${isUser ? styles.userMsg : styles.assistantMsg}`}>
      <div className={styles.messageBody}>
        {isComponentToolMessage && componentPayload ? (
          <ComponentFrame payload={componentPayload} />
        ) : isAssistant ? (
          <div className={styles.messageMarkdown}>
            <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{messageText}</ReactMarkdown>
          </div>
        ) : (
          <div className={styles.messageText}>{messageText}</div>
        )}

        {!isComponentToolMessage && attachments.length > 0 ? (
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
                    {attachment.mime ? <span className={styles.messageAttachmentFileMeta}>{attachment.mime}</span> : null}
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

export type ChatMessagesProps = {
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

export const ChatMessages = memo(function ChatMessages({
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
  const completedToolRuns = useMemo(() => toolRuns.filter((tool) => tool.status !== "running"), [toolRuns]);
  const toolSummaryKey = useMemo(() => {
    if (completedToolRuns.length === 0) return "no-completed-tools";
    return completedToolRuns.map((tool) => tool.id).join("|");
  }, [completedToolRuns]);

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
        key={toolSummaryKey}
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
