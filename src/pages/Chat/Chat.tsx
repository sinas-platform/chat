import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import styles from "./Chat.module.scss";
import { ChatMessages, type ApprovalGroup, type DelegatedNotice } from "./ChatMessages";
import {
  AUDIO_ATTACHMENTS_DISABLED_ERROR,
  AUDIO_ATTACHMENTS_ENABLED,
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_NEAR_BOTTOM_THRESHOLD,
  CHAT_SCROLL_TOP_OFFSET,
  extractErrorMessage,
  extractToolCallId,
  fileToDataUrl,
  getAttachmentErrorMessage,
  getAudioAttachmentErrorMessage,
  getPlaceholderCssVars,
  getToolDescription,
  isAudioCandidate,
  normalizeAudioFormat,
  normalizeToolName,
  shouldRenderMessage,
  stripDataUrlPrefix,
  type ChatMessageViewModel,
  type PendingChatAttachment,
  type ToolRun,
  type ToolRunStatus,
} from "./chatUtils";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { AppBackground } from "../../components/AppBackground/AppBackground";
import { ChatComposer } from "../../components/ChatComposer/ChatComposer";
import { ThemeSwitch } from "../../components/ThemeSwitch/ThemeSwitch";
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import { useChatScrollBehavior } from "../../hooks/useChatScrollBehavior";
import { buildAgentPlaceholderMetaById } from "../../lib/agentPlaceholders";
import { apiClient, type ChatStreamHandle } from "../../lib/api";
import { uploadChatAttachment } from "../../lib/files/filesService";
import type { ChatAttachment } from "../../lib/files/types";
import type {
  AgentResponse,
  ApprovalRequiredEvent,
  ChatWithMessages,
  PendingApproval,
  ToolEndEvent,
  ToolStartEvent,
} from "../../types";

type LocationState = {
  initialDraft?: string;
  initialAttachments?: ChatAttachment[];
  initialContent?: string | Array<Record<string, unknown>>;
};

type SendMessageVariables = {
  content: string | Array<Record<string, unknown>>;
  userTempId: string;
};

const MemoizedAppSidebar = memo(AppSidebar);

type DelegatedToolEndPayload = {
  agent_name?: unknown;
  response?: unknown;
  chat_id?: unknown;
};

function parseDelegatedToolEndPayload(result: unknown): DelegatedToolEndPayload | null {
  if (result && typeof result === "object") {
    return result as DelegatedToolEndPayload;
  }

  if (typeof result !== "string") return null;
  const trimmed = result.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as DelegatedToolEndPayload;
    }
  } catch {
    return null;
  }

  return null;
}

function toApprovalRequiredEvent(approval: PendingApproval): ApprovalRequiredEvent | null {
  const toolCallId = typeof approval.tool_call_id === "string" ? approval.tool_call_id.trim() : "";
  const functionNamespace = typeof approval.function_namespace === "string" ? approval.function_namespace.trim() : "";
  const functionName = typeof approval.function_name === "string" ? approval.function_name.trim() : "";
  const args = approval.arguments;

  if (!toolCallId || !functionNamespace || !functionName || !args || typeof args !== "object") {
    return null;
  }

  return {
    type: "approval_required",
    tool_call_id: toolCallId,
    function_namespace: functionNamespace,
    function_name: functionName,
    arguments: args,
  };
}

function normalizeApprovalEvent(approval: ApprovalRequiredEvent): ApprovalRequiredEvent | null {
  const toolCallId = approval.tool_call_id?.trim();
  const functionNamespace = approval.function_namespace?.trim();
  const functionName = approval.function_name?.trim();
  const args = approval.arguments;

  if (!toolCallId || !functionNamespace || !functionName || !args || typeof args !== "object") {
    return null;
  }

  return {
    type: "approval_required",
    tool_call_id: toolCallId,
    function_namespace: functionNamespace,
    function_name: functionName,
    arguments: args,
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractToolCallIdFromToolCall(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const directId = asNonEmptyString(record.tool_call_id) ?? asNonEmptyString(record.id) ?? asNonEmptyString(record.call_id);
  if (directId) return directId;

  const fn = record.function;
  if (fn && typeof fn === "object") {
    const fnRecord = fn as Record<string, unknown>;
    return asNonEmptyString(fnRecord.tool_call_id) ?? asNonEmptyString(fnRecord.id);
  }

  return null;
}

function buildAssistantMessageIdByToolCallId(messages: ChatWithMessages["messages"] | undefined): Map<string, string> {
  const messageIdByToolCallId = new Map<string, string>();
  if (!Array.isArray(messages)) return messageIdByToolCallId;

  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.id !== "string" || !Array.isArray(message.tool_calls)) {
      continue;
    }

    const messageId = message.id.trim();
    if (!messageId) continue;

    for (const toolCall of message.tool_calls) {
      const toolCallId = extractToolCallIdFromToolCall(toolCall);
      if (!toolCallId || messageIdByToolCallId.has(toolCallId)) continue;
      messageIdByToolCallId.set(toolCallId, messageId);
    }
  }

  return messageIdByToolCallId;
}

function extractApprovalQueries(args: Record<string, unknown>): string[] {
  const queryValue = args.query;
  if (typeof queryValue === "string") {
    const trimmed = queryValue.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(queryValue)) {
    return queryValue
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
  }

  if (queryValue && typeof queryValue === "object") {
    const record = queryValue as Record<string, unknown>;
    const nestedQuery =
      asNonEmptyString(record.query) ??
      asNonEmptyString(record.q) ??
      asNonEmptyString(record.text) ??
      asNonEmptyString(record.value);
    return nestedQuery ? [nestedQuery] : [];
  }

  return [];
}

function toApprovalFunctionLabel(functionName: string, count: number): string {
  const normalized = functionName.trim().toLowerCase();
  if (normalized === "search_web" || normalized === "web_search") {
    return count === 1 ? "web search" : "web searches";
  }

  const pretty = normalized.replace(/[_-]+/g, " ").trim() || "action";
  if (count === 1 || pretty.endsWith("s")) return pretty;
  return `${pretty}s`;
}

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
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
  const initialContent = useMemo<SendMessageVariables["content"] | undefined>(() => {
    const state = location.state as LocationState | null;
    if (!state || state.initialContent === undefined) return undefined;

    if (typeof state.initialContent === "string") return state.initialContent;
    if (Array.isArray(state.initialContent)) return state.initialContent;
    return undefined;
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
  const [streamApprovalsByToolCallId, setStreamApprovalsByToolCallId] = useState<Record<string, ApprovalRequiredEvent>>(
    {}
  );
  const [resolvedToolCallIds, setResolvedToolCallIds] = useState<Set<string>>(() => new Set());
  const [delegatedNoticesByToolCallId, setDelegatedNoticesByToolCallId] = useState<Record<string, DelegatedNotice>>(
    {}
  );
  const [processingApprovalGroupId, setProcessingApprovalGroupId] = useState<string | null>(null);
  const sentInitialDraftRef = useRef<Record<string, boolean>>({});
  const streamHandleRef = useRef<ChatStreamHandle | null>(null);

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
  const delegatedNotices = useMemo(() => Object.values(delegatedNoticesByToolCallId), [delegatedNoticesByToolCallId]);
  const fetchedApprovals = useMemo(() => {
    const fetchedPendingApprovals = Array.isArray(chatData?.pending_approvals) ? chatData.pending_approvals : [];
    return fetchedPendingApprovals
      .map((approval) => toApprovalRequiredEvent(approval))
      .filter((approval): approval is ApprovalRequiredEvent => approval !== null);
  }, [chatData?.pending_approvals]);
  const approvalCandidatesByToolCallId = useMemo(() => {
    const approvalsById = new Map<string, ApprovalRequiredEvent>();

    for (const approval of fetchedApprovals) {
      approvalsById.set(approval.tool_call_id, approval);
    }

    for (const approval of Object.values(streamApprovalsByToolCallId)) {
      approvalsById.set(approval.tool_call_id, approval);
    }

    return approvalsById;
  }, [fetchedApprovals, streamApprovalsByToolCallId]);
  const resolvedApprovalIds = useMemo(() => {
    const resolvedIds = new Set<string>();
    const chatMessages = Array.isArray(chatData?.messages) ? chatData.messages : [];

    for (const message of chatMessages) {
      if (message.role !== "tool" || typeof message.tool_call_id !== "string") continue;
      const toolCallId = message.tool_call_id.trim();
      if (!toolCallId) continue;
      resolvedIds.add(toolCallId);
    }

    for (const toolRun of Object.values(activeTools)) {
      if (toolRun.status !== "done" && toolRun.status !== "error") continue;
      const toolCallId = toolRun.id.trim();
      if (!toolCallId) continue;
      resolvedIds.add(toolCallId);
    }

    for (const toolCallId of resolvedToolCallIds) {
      resolvedIds.add(toolCallId);
    }

    return resolvedIds;
  }, [chatData?.messages, activeTools, resolvedToolCallIds]);
  const pendingApprovals = useMemo(() => {
    const visibleApprovals: ApprovalRequiredEvent[] = [];

    for (const approval of approvalCandidatesByToolCallId.values()) {
      if (resolvedApprovalIds.has(approval.tool_call_id)) continue;
      visibleApprovals.push(approval);
    }

    return visibleApprovals;
  }, [approvalCandidatesByToolCallId, resolvedApprovalIds]);
  const assistantMessageIdByToolCallId = useMemo(
    () => buildAssistantMessageIdByToolCallId(Array.isArray(chatData?.messages) ? chatData.messages : undefined),
    [chatData?.messages]
  );
  const approvalGroups = useMemo<ApprovalGroup[]>(() => {
    const groupsById = new Map<string, ApprovalGroup>();

    for (const approval of pendingApprovals) {
      const assistantMessageId = assistantMessageIdByToolCallId.get(approval.tool_call_id) ?? null;
      const fallbackGroupId = `${approval.function_namespace}/${approval.function_name}`;
      const groupId = assistantMessageId ?? fallbackGroupId;
      const queries = extractApprovalQueries(approval.arguments);
      const existing = groupsById.get(groupId);

      if (!existing) {
        groupsById.set(groupId, {
          id: groupId,
          assistantMessageId,
          functionNamespace: approval.function_namespace,
          functionName: approval.function_name,
          functionLabel: toApprovalFunctionLabel(approval.function_name, 1),
          count: 1,
          toolCallIds: [approval.tool_call_id],
          previewQuery: queries[0] ?? null,
          queries,
        });
        continue;
      }

      const count = existing.count + 1;
      groupsById.set(groupId, {
        ...existing,
        functionLabel: toApprovalFunctionLabel(existing.functionName, count),
        count,
        toolCallIds: [...existing.toolCallIds, approval.tool_call_id],
        previewQuery: existing.previewQuery ?? queries[0] ?? null,
        queries: [...existing.queries, ...queries],
      });
    }

    return Array.from(groupsById.values()).map((group) => ({
      ...group,
      queries: Array.from(new Set(group.queries)),
    }));
  }, [pendingApprovals, assistantMessageIdByToolCallId]);

  const userMessageCount = useMemo(() => messages.filter((message) => message.role === "user").length, [messages]);
  const hasRunningTool = useMemo(() => toolRuns.some((tool) => tool.status === "running"), [toolRuns]);
  const hasPendingApproval = approvalGroups.length > 0;
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

  function resetToolRuns() {
    setActiveTools({});
  }

  function handleToolStart(event: ToolStartEvent) {
    const now = new Date().toISOString();
    const toolName = normalizeToolName(event.name);

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

  function upsertDelegatedNotice(nextNotice: DelegatedNotice) {
    setDelegatedNoticesByToolCallId((prev) => {
      const existing = prev[nextNotice.tool_call_id];
      if (
        existing &&
        existing.agentName === nextNotice.agentName &&
        existing.chatId === nextNotice.chatId &&
        existing.previewText === nextNotice.previewText &&
        existing.pendingApprovalCount === nextNotice.pendingApprovalCount
      ) {
        return prev;
      }

      return {
        ...prev,
        [nextNotice.tool_call_id]: nextNotice,
      };
    });
  }

  async function handleDelegatedToolEnd(event: ToolEndEvent, toolName: string) {
    if (!toolName.startsWith("call_agent_")) return;

    const payload = parseDelegatedToolEndPayload(event.result);
    if (!payload) return;

    const toolCallId = event.tool_call_id?.trim();
    if (!toolCallId) return;

    const agentName =
      typeof payload.agent_name === "string" && payload.agent_name.trim().length > 0
        ? payload.agent_name.trim()
        : "Delegated agent";
    const previewText = typeof payload.response === "string" ? payload.response.trim() : "";
    const delegatedChatId =
      typeof payload.chat_id === "string" && payload.chat_id.trim().length > 0 ? payload.chat_id.trim() : "";

    if (previewText.length > 0) {
      upsertDelegatedNotice({
        tool_call_id: toolCallId,
        agentName,
        chatId: delegatedChatId,
        previewText,
        pendingApprovalCount: 0,
      });
      return;
    }

    if (!delegatedChatId) return;

    let pendingApprovalCount = 0;
    try {
      const delegatedChat = await apiClient.getChat(delegatedChatId);
      pendingApprovalCount = Array.isArray(delegatedChat.pending_approvals) ? delegatedChat.pending_approvals.length : 0;
    } catch (error) {
      console.error("Failed to fetch delegated chat:", error);
    }

    upsertDelegatedNotice({
      tool_call_id: toolCallId,
      agentName,
      chatId: delegatedChatId,
      previewText: "",
      pendingApprovalCount,
    });
  }

  function handleToolEnd(event: ToolEndEvent) {
    const now = new Date().toISOString();
    const toolName = normalizeToolName(event.name);

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

    void handleDelegatedToolEnd(event, toolName);
  }

  function handleToolError(error: unknown) {
    const now = new Date().toISOString();
    const toolCallId = extractToolCallId(error);
    const errorMessage = extractErrorMessage(error);

    if (toolCallId) {
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
    const normalizedApproval = normalizeApprovalEvent(approval);
    if (!normalizedApproval) return;

    setStreamApprovalsByToolCallId((prev) => {
      const existing = prev[normalizedApproval.tool_call_id];
      if (
        existing &&
        existing.function_namespace === normalizedApproval.function_namespace &&
        existing.function_name === normalizedApproval.function_name &&
        existing.arguments === normalizedApproval.arguments
      ) {
        return prev;
      }

      return {
        ...prev,
        [normalizedApproval.tool_call_id]: normalizedApproval,
      };
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

  async function handleApprovalGroup(group: ApprovalGroup, approved: boolean) {
    if (!chatId || isStreaming || processingApprovalGroupId) return;
    const firstToolCallId = group.toolCallIds[0]?.trim();
    if (!firstToolCallId) return;

    const newlyResolvedToolCallIds = group.toolCallIds
      .map((toolCallId) => toolCallId.trim())
      .filter((toolCallId) => toolCallId.length > 0 && !resolvedToolCallIds.has(toolCallId));

    setProcessingApprovalGroupId(group.id);
    setResolvedToolCallIds((prev) => {
      const next = new Set(prev);
      for (const toolCallId of group.toolCallIds) {
        const normalized = toolCallId.trim();
        if (!normalized) continue;
        next.add(normalized);
      }
      return next;
    });

    try {
      const channelId = await apiClient.approveToolCall(chatId, firstToolCallId, approved);
      await resumeApprovalStream(channelId);
    } catch (error) {
      console.error("Approval error:", error);
      setResolvedToolCallIds((prev) => {
        const next = new Set(prev);
        for (const toolCallId of newlyResolvedToolCallIds) {
          next.delete(toolCallId);
        }
        return next;
      });
      setIsStreaming(false);
      setStreamingContent("");
      streamHandleRef.current = null;
      alert("Failed to process approval. Please try again.");
      await refreshChat();
    } finally {
      setProcessingApprovalGroupId(null);
    }
  }

  function handleStop() {
    streamHandleRef.current?.abort();
  }

  const sendMsgM = useMutation<void, Error, SendMessageVariables, { previous?: ChatWithMessages }>({
    mutationFn: async (vars: SendMessageVariables) => {
      if (!chatId) throw new Error("Missing chatId");
      await sendStreamingMessage(vars.content);
    },
    onMutate: async (vars: SendMessageVariables) => {
      if (!chatId) return {};

      await queryClient.cancelQueries({ queryKey: ["chat", chatId] });
      const previous = queryClient.getQueryData<ChatWithMessages>(["chat", chatId]);

      queryClient.setQueryData<ChatWithMessages>(["chat", chatId], (old) => {
        if (!old) return old;
        const nextUserMsg = {
          id: vars.userTempId,
          role: "user",
          content: vars.content,
          created_at: new Date().toISOString(),
        } as unknown as ChatWithMessages["messages"][number];
        const oldMsgs = Array.isArray(old.messages) ? old.messages : [];
        return { ...old, messages: [...oldMsgs, nextUserMsg] };
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (!chatId) return;
      if (ctx?.previous) queryClient.setQueryData<ChatWithMessages>(["chat", chatId], ctx.previous);
    },
  });

  useEffect(() => {
    return () => {
      streamHandleRef.current?.abort();
      streamHandleRef.current = null;
    };
  }, []);

  useEffect(() => {
    streamHandleRef.current?.abort();
    streamHandleRef.current = null;
    setIsStreaming(false);
    setStreamingContent("");
    setActiveTools({});
    setStreamApprovalsByToolCallId({});
    setResolvedToolCallIds(new Set());
    setDelegatedNoticesByToolCallId({});
    setProcessingApprovalGroupId(null);
  }, [chatId]);

  // Auto-send initial draft once
  useEffect(() => {
    if (!chatId) return;
    if (initialContent === undefined && !initialDraft && initialAttachments.length === 0) return;
    if (chatQ.isLoading || chatQ.isError) return;
    if (hasUserMessages) {
      sentInitialDraftRef.current[chatId] = true;
      return;
    }

    if (sentInitialDraftRef.current[chatId]) return;
    sentInitialDraftRef.current[chatId] = true;

    const ts = Date.now();
    requestPinLatestUserMessage();
    const legacyInitialContent =
      initialAttachments.length > 0
        ? [
            ...(initialDraft ? [{ type: "text", text: initialDraft }] : []),
            ...initialAttachments.map((attachment) => ({
              type: attachment.mime.toLowerCase().startsWith("image/") ? "image" : "file",
              ...(attachment.mime.toLowerCase().startsWith("image/")
                ? { image: attachment.url }
                : { file_url: attachment.url, filename: attachment.name, mime_type: attachment.mime }),
            })),
          ]
        : initialDraft;

    sendMsgM.mutate({
      content: initialContent ?? legacyInitialContent,
      userTempId: `tmp-user-${ts}`,
    });
  }, [chatId, initialDraft, initialAttachments, initialContent, chatQ.isLoading, chatQ.isError, hasUserMessages, requestPinLatestUserMessage, sendMsgM]);

  async function addAttachment(file: File) {
    if (!chatId || isUploadingAttachment || sendMsgM.isPending || isStreaming || approvalGroups.length > 0) return;

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
    if (sendMsgM.isPending || isUploadingAttachment || isStreaming || processingApprovalGroupId || approvalGroups.length > 0) return;
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
                : ({
                    type: "file",
                    file_url: attachment.url,
                    filename: attachment.name,
                    mime_type: attachment.mime,
                  } as const);
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
          <AppBackground />
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
        <AppBackground />
        <ThemeSwitch className={styles.themeSwitch} />

        <div className={styles.chatShell} style={getPlaceholderCssVars(assistantAvatarPlaceholder)}>
          <ChatMessages
            messages={messages}
            isLoading={chatQ.isLoading}
            isError={chatQ.isError}
            isPending={sendMsgM.isPending}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            thinkingText={thinkingText}
            toolRuns={toolRuns}
            delegatedNotices={delegatedNotices}
            approvalGroups={approvalGroups}
            processingApprovalGroupId={processingApprovalGroupId}
            onOpenDelegatedChat={(delegatedChatId) => {
              navigate({ pathname: `/chats/${encodeURIComponent(delegatedChatId)}`, search: location.search });
            }}
            onApprovalDecision={(group, approved) => {
              void handleApprovalGroup(group, approved);
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
            rows={2}
            disabled={sendMsgM.isPending || isStreaming || Boolean(processingApprovalGroupId) || approvalGroups.length > 0}
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
