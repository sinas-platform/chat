import { Fragment, memo, useEffect, useMemo, useState, type RefObject } from "react";
import { Bot, CircleHelp, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./Chat.module.scss";
import { HtmlPreviewCard } from "./HtmlPreviewCard";
import SinasLoader from "../../components/Loader/Loader";
import type { AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import {
  STREAMING_ASSISTANT_ACTIVITY_ID,
  type AssistantBackgroundActivity,
  type BackgroundActivityItem,
  extractHtmlPreview,
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

export type DelegatedNotice = {
  tool_call_id: string;
  agentName: string;
  chatId: string;
  previewText: string;
  pendingApprovalCount: number;
};

export type ApprovalGroup = {
  id: string;
  assistantMessageId: string | null;
  functionNamespace: string;
  functionName: string;
  functionLabel: string;
  count: number;
  toolCallIds: string[];
  previewQuery: string | null;
  queries: string[];
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
        <span className={styles.messageAttachmentImageFallbackText}>
          Couldn't load this image. The link may have expired or the format may be unsupported.
        </span>
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

type ApprovalGroupPromptRowProps = {
  group: ApprovalGroup;
  isProcessing: boolean;
  disableActions: boolean;
  onApprove: () => void;
  onReject: () => void;
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
};

const ApprovalGroupPromptRow = memo(function ApprovalGroupPromptRow({
  group,
  isProcessing,
  disableActions,
  onApprove,
  onReject,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
}: ApprovalGroupPromptRowProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const title = group.count === 1 ? `Approve ${group.functionLabel}?` : `Approve ${group.count} ${group.functionLabel}?`;
  const queryPreview = group.previewQuery?.trim();
  const detailsButtonLabel = isDetailsOpen ? "Hide details" : "Show details";

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
          <h4 className={styles.approvalTitle}>{isProcessing ? "Processing your decision..." : title}</h4>
          <p className={styles.approvalText}>
            {queryPreview ? `First query: "${queryPreview}"` : "Approve to continue, or reject to stop this batch."}
          </p>

          {group.queries.length > 0 ? (
            <>
              <button
                type="button"
                className={styles.toolActivityInfoButton}
                aria-expanded={isDetailsOpen}
                aria-label={isDetailsOpen ? "Hide approval details" : "Show approval details"}
                onClick={() => setIsDetailsOpen((prev) => !prev)}
              >
                <CircleHelp className={styles.toolActivityInfoIcon} aria-hidden="true" />
                <span>{detailsButtonLabel}</span>
              </button>

              {isDetailsOpen ? (
                <ul className={styles.messageFileAttachments}>
                  {group.queries.map((query, index) => (
                    <li key={`${group.id}-${index}`} className={styles.messageAttachmentFile}>
                      <span className={styles.messageAttachmentFileMeta}>{query}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}

          <p className={styles.approvalHint}>Approve all to continue this batch, or reject all to stop it.</p>

          <div className={styles.approvalActions}>
            <button
              type="button"
              className={`${styles.approvalButton} ${styles.approveButton}`}
              onClick={onApprove}
              disabled={disableActions}
            >
              {isProcessing ? "Processing..." : "Approve all"}
            </button>
            <button
              type="button"
              className={`${styles.approvalButton} ${styles.rejectButton}`}
              onClick={onReject}
              disabled={disableActions}
            >
              Reject all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

ApprovalGroupPromptRow.displayName = "ApprovalGroupPromptRow";

type BackgroundActivitySummary = {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pendingApproval: number;
  unknown: number;
};

function summarizeBackgroundActivities(items: BackgroundActivityItem[]): BackgroundActivitySummary {
  const summary: BackgroundActivitySummary = {
    total: items.length,
    completed: 0,
    failed: 0,
    running: 0,
    pendingApproval: 0,
    unknown: 0,
  };

  for (const item of items) {
    if (item.status === "completed") summary.completed += 1;
    else if (item.status === "failed") summary.failed += 1;
    else if (item.status === "running") summary.running += 1;
    else if (item.status === "pending_approval") summary.pendingApproval += 1;
    else summary.unknown += 1;
  }

  return summary;
}

function toBackgroundSummaryText(summary: BackgroundActivitySummary): string {
  if (summary.failed > 0) {
    return `${summary.completed} completed, ${summary.failed} ${summary.failed === 1 ? "had an issue" : "had issues"}.`;
  }

  if (summary.running > 0 && summary.completed === 0 && summary.pendingApproval === 0 && summary.unknown === 0) {
    return `${summary.running} background ${summary.running === 1 ? "step is" : "steps are"} running.`;
  }

  if (summary.pendingApproval > 0 && summary.completed === 0 && summary.running === 0 && summary.unknown === 0) {
    return `${summary.pendingApproval} ${summary.pendingApproval === 1 ? "step is" : "steps are"} waiting for approval.`;
  }

  if (summary.completed === summary.total) {
    return `${summary.completed} background ${summary.completed === 1 ? "step" : "steps"} completed.`;
  }

  return `${summary.completed} completed, ${summary.running} running, ${summary.pendingApproval} pending approval, ${summary.unknown} unknown.`;
}

function toBackgroundActivityStatusText(status: BackgroundActivityItem["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  if (status === "pending_approval") return "Pending approval";
  return "No result yet";
}

type BackgroundActivityRowsProps = {
  items: BackgroundActivityItem[];
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
};

const BackgroundActivityRows = memo(function BackgroundActivityRows({
  items,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
}: BackgroundActivityRowsProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  if (items.length === 0) return null;

  const summary = summarizeBackgroundActivities(items);
  const summaryText = toBackgroundSummaryText(summary);

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
            summary.failed > 0 && styles.toolActivitySummaryCardError,
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
              {items.map((tool) => {
                const isDone = tool.status === "completed";
                const isError = tool.status === "failed";
                const statusText = toBackgroundActivityStatusText(tool.status);

                return (
                  <div
                    key={tool.toolCallId}
                    className={joinClasses(
                      styles.toolProgressCard,
                      styles.toolActivityDetailsCard,
                      isDone && styles.toolProgressDone,
                      isError && styles.toolProgressError,
                    )}
                  >
                    <span
                      className={joinClasses(
                        styles.toolProgressDot,
                        isDone && styles.toolProgressDotDone,
                        isError && styles.toolProgressDotError,
                      )}
                      aria-hidden="true"
                    />
                    <div className={styles.toolProgressContent}>
                      <p className={styles.toolProgressDescription}>{tool.title}</p>
                      <p className={styles.toolProgressMeta}>
                        <code className={styles.toolProgressName}>{tool.functionName}</code>
                        <span className={styles.toolProgressStatus}>{statusText}</span>
                      </p>
                      {tool.status === "failed" && tool.error ? (
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

BackgroundActivityRows.displayName = "BackgroundActivityRows";

type DelegatedNoticeRowsProps = {
  notices: DelegatedNotice[];
  onOpenDelegatedChat?: (chatId: string) => void;
  assistantAvatarSrc?: string;
  assistantAvatarPlaceholder?: AgentPlaceholderMeta;
  onAssistantAvatarError?: () => void;
};

const DelegatedNoticeRows = memo(function DelegatedNoticeRows({
  notices,
  onOpenDelegatedChat,
  assistantAvatarSrc,
  assistantAvatarPlaceholder,
  onAssistantAvatarError,
}: DelegatedNoticeRowsProps) {
  if (notices.length === 0) return null;

  return (
    <div className={styles.toolProgressInlineList}>
      {notices.map((notice) => {
        const hasChatId = notice.chatId.trim().length > 0;
        const needsApproval = notice.pendingApprovalCount > 0;
        const statusText = needsApproval
          ? `Needs approval (${notice.pendingApprovalCount})`
          : "Open delegated chat to continue";

        return (
          <div key={notice.tool_call_id} className={`${styles.messageRow} ${styles.assistantRow}`}>
            <AssistantAvatar
              assistantAvatarSrc={assistantAvatarSrc}
              assistantAvatarPlaceholder={assistantAvatarPlaceholder}
              onAssistantAvatarError={onAssistantAvatarError}
            />

            <div className={`${styles.delegatedNoticeCard} ${needsApproval ? styles.delegatedNoticeCardNeedsApproval : ""}`}>
              <div className={styles.delegatedNoticeHeader}>
                <div className={styles.delegatedNoticeHeaderText}>
                  <p className={styles.delegatedNoticeTitle}>{notice.agentName}</p>
                  <p className={styles.delegatedNoticeStatus}>{statusText}</p>
                </div>
                {hasChatId ? (
                  <button
                    type="button"
                    className={styles.delegatedNoticeOpenButton}
                    onClick={() => onOpenDelegatedChat?.(notice.chatId)}
                  >
                    Open delegated chat
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

DelegatedNoticeRows.displayName = "DelegatedNoticeRows";

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
  const htmlPreview = extractHtmlPreview(message.content);
  const isComponentToolMessage = message.role === "tool" && componentPayload !== null;
  const isHtmlPreviewToolMessage = message.role === "tool" && htmlPreview !== null;
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");
  const audioAttachments = attachments.filter((attachment) => attachment.kind === "audio");
  const useCompactImageAttachments = imageAttachments.length > 1;
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant" || isComponentToolMessage || isHtmlPreviewToolMessage;
  const shouldHideAssistantBubble = isAssistant && showAssistantAvatarLoading;
  const hasVisibleAssistantMessageContent =
    isComponentToolMessage || isHtmlPreviewToolMessage || messageText.trim().length > 0 || attachments.length > 0;
  const [openRunningToolId, setOpenRunningToolId] = useState<string | null>(null);
  const isRunningToolDetailsOpen = runningTool ? openRunningToolId === runningTool.id : false;
  const htmlPreviewFallbackText =
    htmlPreview?.text?.trim() ||
    (messageText.trim().length > 0 && messageText.trim() !== htmlPreview?.html.trim() ? messageText : undefined);

  const messageBubble = !shouldHideAssistantBubble && (isUser || hasVisibleAssistantMessageContent) ? (
    <div className={`${styles.message} ${isUser ? styles.userMsg : styles.assistantMsg}`}>
      <div className={styles.messageBody}>
        {isComponentToolMessage && componentPayload ? (
          <ComponentFrame payload={componentPayload} />
        ) : isHtmlPreviewToolMessage && htmlPreview ? (
          <HtmlPreviewCard html={htmlPreview.html} subject={htmlPreview.subject} fallbackText={htmlPreviewFallbackText} />
        ) : isAssistant ? (
          <div className={styles.messageMarkdown}>
            <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{messageText}</ReactMarkdown>
          </div>
        ) : (
          <div className={styles.messageText}>{messageText}</div>
        )}

        {!isComponentToolMessage && !isHtmlPreviewToolMessage && attachments.length > 0 ? (
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

  if (isAssistant && !messageBubble && !(runningTool && isRunningToolDetailsOpen)) {
    return null;
  }

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
  backgroundActivities: AssistantBackgroundActivity[];
  delegatedNotices: DelegatedNotice[];
  approvalGroups: ApprovalGroup[];
  processingApprovalGroupId: string | null;
  onOpenDelegatedChat?: (chatId: string) => void;
  onApprovalDecision: (group: ApprovalGroup, approved: boolean) => void;
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
  backgroundActivities,
  delegatedNotices,
  approvalGroups,
  processingApprovalGroupId,
  onOpenDelegatedChat,
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
  const backgroundActivitiesByAssistantMessageId = useMemo(() => {
    const map = new Map<string, BackgroundActivityItem[]>();
    const orphanItems: BackgroundActivityItem[] = [];
    const streamingItems: BackgroundActivityItem[] = [];

    for (const activity of backgroundActivities) {
      if (activity.assistantMessageId === STREAMING_ASSISTANT_ACTIVITY_ID) {
        streamingItems.push(...activity.items);
        continue;
      }

      if (!activity.assistantMessageId) {
        orphanItems.push(...activity.items);
        continue;
      }

      map.set(activity.assistantMessageId, activity.items);
    }

    return {
      byAssistantMessageId: map,
      orphanItems,
      streamingItems,
    };
  }, [backgroundActivities]);
  const hasBackgroundActivity = backgroundActivities.length > 0;

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
      ) : messages.length === 0 && approvalGroups.length === 0 && !hasBackgroundActivity ? (
        <div className={styles.empty}>No messages yet</div>
      ) : (
        messages.map((message, index) => {
          const isLastMessage = index === messages.length - 1;
          const shouldShowAssistantLoading =
            isWaitingForFirstChunk &&
            isLastMessage &&
            message.role === "assistant" &&
            getMessageText(message.content).length === 0;
          const assistantMessageId = typeof message.id === "string" ? message.id.trim() : "";
          const activityItems =
            message.role === "assistant" && assistantMessageId
              ? (backgroundActivitiesByAssistantMessageId.byAssistantMessageId.get(assistantMessageId) ?? [])
              : [];
          const rowKey = message.id ?? `${message.role ?? "message"}-${message.created_at ?? "unknown"}-${index}`;

          return (
            <Fragment key={rowKey}>
              <ChatMessageRow
                message={message}
                showAssistantAvatarLoading={shouldShowAssistantLoading}
                showAssistantAvatarPulse={shouldShowAssistantLoading}
                assistantAvatarSrc={assistantAvatarSrc}
                assistantAvatarPlaceholder={assistantAvatarPlaceholder}
                onAssistantAvatarError={onAssistantAvatarError}
                rowRef={index === latestUserMessageIndex ? onLastUserMessageRef : undefined}
              />
              {activityItems.length > 0 ? (
                <BackgroundActivityRows
                  items={activityItems}
                  assistantAvatarSrc={assistantAvatarSrc}
                  assistantAvatarPlaceholder={assistantAvatarPlaceholder}
                  onAssistantAvatarError={onAssistantAvatarError}
                />
              ) : null}
            </Fragment>
          );
        })
      )}

      {backgroundActivitiesByAssistantMessageId.orphanItems.length > 0 ? (
        <BackgroundActivityRows
          items={backgroundActivitiesByAssistantMessageId.orphanItems}
          assistantAvatarSrc={assistantAvatarSrc}
          assistantAvatarPlaceholder={assistantAvatarPlaceholder}
          onAssistantAvatarError={onAssistantAvatarError}
        />
      ) : null}

      {backgroundActivitiesByAssistantMessageId.streamingItems.length > 0 ? (
        <BackgroundActivityRows
          items={backgroundActivitiesByAssistantMessageId.streamingItems}
          assistantAvatarSrc={assistantAvatarSrc}
          assistantAvatarPlaceholder={assistantAvatarPlaceholder}
          onAssistantAvatarError={onAssistantAvatarError}
        />
      ) : null}

      <DelegatedNoticeRows
        notices={delegatedNotices}
        onOpenDelegatedChat={onOpenDelegatedChat}
        assistantAvatarSrc={assistantAvatarSrc}
        assistantAvatarPlaceholder={assistantAvatarPlaceholder}
        onAssistantAvatarError={onAssistantAvatarError}
      />

      {approvalGroups.map((group) => {
        const isProcessing = processingApprovalGroupId === group.id;
        const disableActions = Boolean(processingApprovalGroupId) || isStreaming;

        return (
          <ApprovalGroupPromptRow
            key={group.id}
            group={group}
            isProcessing={isProcessing}
            disableActions={disableActions}
            onApprove={() => onApprovalDecision(group, true)}
            onReject={() => onApprovalDecision(group, false)}
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
