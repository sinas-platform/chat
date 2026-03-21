import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import styles from "./Chat.module.scss";
import { ChatMessages } from "./ChatMessages";
import {
  AUDIO_ATTACHMENTS_DISABLED_ERROR,
  AUDIO_ATTACHMENTS_ENABLED,
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_NEAR_BOTTOM_THRESHOLD,
  CHAT_SCROLL_TOP_OFFSET,
  TOOL_RUN_AUTO_REMOVE_MS,
  UNSUPPORTED_AUDIO_ERROR,
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
import { ChatComposer } from "../../components/ChatComposer/ChatComposer";
import { ThemeSwitch } from "../../components/ThemeSwitch/ThemeSwitch";
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import { useChatScrollBehavior } from "../../hooks/useChatScrollBehavior";
import { buildAgentPlaceholderMetaById } from "../../lib/agentPlaceholders";
import { apiClient, type ChatStreamHandle } from "../../lib/api";
import { uploadChatAttachment } from "../../lib/files/filesService";
import type { ChatAttachment } from "../../lib/files/types";
import type { AgentResponse, ApprovalRequiredEvent, ChatWithMessages, ToolEndEvent, ToolStartEvent } from "../../types";

type LocationState = {
  initialDraft?: string;
  initialAttachments?: ChatAttachment[];
};

type SendMessageVariables = {
  content: string | Array<Record<string, unknown>>;
  userTempId: string;
};

const MemoizedAppSidebar = memo(AppSidebar);

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
            rows={2}
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
