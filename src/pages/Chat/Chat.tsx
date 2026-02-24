import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./Chat.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { ChatComposer } from "../../components/ChatComposer/ChatComposer";
import SinasLoader from "../../components/Loader/Loader";
import { apiClient } from "../../lib/api";
import { uploadChatAttachment, UploadChatAttachmentError } from "../../lib/files/filesService";
import type { ChatAttachment } from "../../lib/files/types";
import sinasLogoSmall from "../../icons/sinas-logo-small.svg";

type LocationState = {
  initialDraft?: string;
  initialAttachments?: ChatAttachment[];
};

type SendMessageVariables = {
  content: string;
  attachments: ChatAttachment[];
  userTempId: string;
  assistantTempId: string;
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
};

type RenderedMessageAttachment = {
  kind: "image" | "file";
  url: string;
  name?: string;
  mime?: string;
};

type ParsedMessageContent = {
  text: string;
  attachments: RenderedMessageAttachment[];
};

const MARKDOWN_PLUGINS = [remarkGfm];
const MemoizedAppSidebar = memo(AppSidebar);
const DEFAULT_ATTACHMENT_ERROR = "File uploads aren’t configured on this Sinas instance. Ask admin to configure it.";

function getAttachmentErrorMessage(error: unknown): string {
  if (error instanceof UploadChatAttachmentError) {
    if (error.code === "file_too_large") return "File is too large. Max size is 20 MB.";
    if (error.code === "no_permission") return "No permission to upload files";
    return DEFAULT_ATTACHMENT_ERROR;
  }

  return DEFAULT_ATTACHMENT_ERROR;
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
      return type === "text" || type === "image" || type === "file";
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
          name: getFilenameFromUrl(imageUrl),
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

type ChatMessageRowProps = {
  message: ChatMessageViewModel;
  showAssistantAvatarLoading?: boolean;
};

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  showAssistantAvatarLoading = false,
}: ChatMessageRowProps) {
  const { text: messageText, attachments } = parseMessageContent(message.content);
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");
  const useCompactImageAttachments = imageAttachments.length > 1;
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const shouldHideAssistantBubble = isAssistant && showAssistantAvatarLoading;

  return (
    <div className={`${styles.messageRow} ${isUser ? styles.userRow : styles.assistantRow}`}>
      {isAssistant ? (
        <div className={styles.assistantAvatar}>
          {showAssistantAvatarLoading ? (
            <div className={styles.assistantAvatarLoading} role="status" aria-live="polite" aria-label="Generating response">
              <SinasLoader size={24} />
            </div>
          ) : (
            <img className={styles.assistantAvatarImage} src={sinasLogoSmall} alt="" aria-hidden="true" />
          )}
        </div>
      ) : null}

      {!shouldHideAssistantBubble ? (
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
                      <a
                        key={`${attachment.url}-${index}`}
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`${styles.messageAttachmentImageLink} ${
                          useCompactImageAttachments ? styles.messageAttachmentImageLinkCompact : ""
                        }`}
                      >
                        <img
                          className={styles.messageAttachmentImage}
                          src={attachment.url}
                          alt={attachment.name || "Attached image"}
                          loading="lazy"
                        />
                      </a>
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
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

ChatMessageRow.displayName = "ChatMessageRow";

const ChatMessages = memo(function ChatMessages({ messages, isLoading, isError, isPending }: ChatMessagesProps) {
  const lastMessage = messages[messages.length - 1];
  const isWaitingForFirstChunk =
    isPending &&
    lastMessage?.role === "assistant" &&
    getMessageText(lastMessage.content).length === 0;

  return (
    <div className={styles.messages}>
      {isError ? <div className={styles.error}>Could not load chat</div> : null}

      {isLoading && messages.length === 0 ? (
        <div className={styles.loadingState} role="status" aria-live="polite">
          <SinasLoader size={28} />
          <span className={styles.loadingText}>Loading conversation...</span>
        </div>
      ) : messages.length === 0 ? (
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
            />
          );
        })
      )}
    </div>
  );
});

ChatMessages.displayName = "ChatMessages";

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();

  const initialDraft = useMemo(() => {
    const state = location.state as LocationState | null;
    return state?.initialDraft?.trim() ?? "";
  }, [location.state]);
  const initialAttachments = useMemo(() => {
    const state = location.state as LocationState | null;
    return Array.isArray(state?.initialAttachments) ? state.initialAttachments : [];
  }, [location.state]);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [uploadingAttachmentName, setUploadingAttachmentName] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const sentInitialDraftRef = useRef<Record<string, boolean>>({});

  const chatQ = useQuery({
    queryKey: ["chat", chatId],
    enabled: !!chatId,
    queryFn: async () => apiClient.getChat(chatId!),
  });

  const messages: ChatMessageViewModel[] = useMemo(() => {
    const data: any = chatQ.data;
    if (!data) return [];
    return Array.isArray(data.messages) ? (data.messages as ChatMessageViewModel[]) : [];
  }, [chatQ.data]);

  const chatTitle = useMemo(() => {
    const rawTitle = (chatQ.data as any)?.title;
    if (typeof rawTitle !== "string") return "Chat";

    const trimmedTitle = rawTitle.trim();
    return trimmedTitle || "Chat";
  }, [chatQ.data]);

  useEffect(() => {
    document.title = `${chatTitle}`;
  }, [chatTitle]);

  const sendMsgM = useMutation({
    mutationFn: async (vars: SendMessageVariables) => {
      if (!chatId) throw new Error("Missing chatId");
      await apiClient.sendMessageStream(
        chatId,
        {
          content: vars.content,
          ...(vars.attachments.length > 0 ? { attachments: vars.attachments } : {}),
        },
        {
          onChunk: (chunk) => {
            queryClient.setQueryData(["chat", chatId], (old: any) => {
              if (!old) return old;

              const oldMsgs = Array.isArray(old.messages) ? old.messages : [];
              const nextMsgs = oldMsgs.map((msg: any) => {
                if (msg.id !== vars.assistantTempId) return msg;

                const previousText = getMessageText(msg.content);
                const nextText =
                  chunk.mode === "replace" ? chunk.text : `${previousText}${chunk.text}`;

                return { ...msg, content: nextText };
              });

              return { ...old, messages: nextMsgs };
            });
          },
        }
      );
    },
    onMutate: async (vars: SendMessageVariables) => {
      if (!chatId) return;

      // Cancel in-flight chat query so we don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["chat", chatId] });

      // Snapshot previous value
      const previous = queryClient.getQueryData<any>(["chat", chatId]);

      // Optimistically add the user message
      queryClient.setQueryData(["chat", chatId], (old: any) => {
        if (!old) return old;
        const optimisticUserContent =
          vars.attachments.length > 0
            ? [
                ...(vars.content ? [{ type: "text", text: vars.content }] : []),
                ...vars.attachments.map((attachment) => ({
                  type: attachment.mime.toLowerCase().startsWith("image/") ? "image" : "file",
                  ...(attachment.mime.toLowerCase().startsWith("image/")
                    ? { image: attachment.url }
                    : { file: attachment.url, name: attachment.name, mime: attachment.mime }),
                })),
              ]
            : vars.content;
        const nextUserMsg: any = {
          id: vars.userTempId,
          role: "user",
          content: optimisticUserContent,
          created_at: new Date().toISOString(),
        };
        const nextAssistantMsg: any = {
          id: vars.assistantTempId,
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
        };
        const oldMsgs = Array.isArray(old.messages) ? old.messages : [];
        return { ...old, messages: [...oldMsgs, nextUserMsg, nextAssistantMsg] };
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (!chatId) return;
      // Roll back optimistic update
      if (ctx?.previous) queryClient.setQueryData(["chat", chatId], ctx.previous);
    },
    onSettled: () => {
      if (!chatId) return;
      // Refetch chat so temp IDs/partial content are replaced by server data
      queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    },
  });

  // Auto-send initial draft once
  useEffect(() => {
    if (!chatId) return;
    if (!initialDraft && initialAttachments.length === 0) return;
    if (chatQ.isLoading || chatQ.isError) return;

    if (sentInitialDraftRef.current[chatId]) return;
    sentInitialDraftRef.current[chatId] = true;

    const ts = Date.now();
    sendMsgM.mutate({
      content: initialDraft,
      attachments: initialAttachments,
      userTempId: `tmp-user-${ts}`,
      assistantTempId: `tmp-assistant-${ts}`,
    });
  }, [chatId, initialDraft, initialAttachments, chatQ.isLoading, chatQ.isError, sendMsgM]);

  async function addAttachment(file: File) {
    if (!chatId || isUploadingAttachment || sendMsgM.isPending) return;

    setAttachmentError(null);
    setIsUploadingAttachment(true);
    setUploadingAttachmentName(file.name);

    try {
      const uploadedAttachment = await uploadChatAttachment(file, chatId);
      setAttachments((prev) => [...prev, uploadedAttachment]);
    } catch (error) {
      setAttachmentError(getAttachmentErrorMessage(error));
    } finally {
      setIsUploadingAttachment(false);
      setUploadingAttachmentName(null);
    }
  }

  function removeAttachment(indexToRemove: number) {
    setAttachmentError(null);
    setAttachments((prev) => prev.filter((_, index) => index !== indexToRemove));
  }

  function submitInput() {
    const trimmed = input.trim();
    if (sendMsgM.isPending || isUploadingAttachment) return;
    if (!trimmed && attachments.length === 0) return;

    const ts = Date.now();
    const attachmentsToSend = [...attachments];
    sendMsgM.mutate({
      content: trimmed,
      attachments: attachmentsToSend,
      userTempId: `tmp-user-${ts}`,
      assistantTempId: `tmp-assistant-${ts}`,
    });
    setInput("");
    setAttachments([]);
    setAttachmentError(null);
  }

  if (!chatId) {
    return (
      <div className={styles.layout}>
        <MemoizedAppSidebar />
        <main className={styles.main}>
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
        <div className={styles.chatShell}>
          <ChatMessages
            messages={messages}
            isLoading={chatQ.isLoading}
            isError={chatQ.isError}
            isPending={sendMsgM.isPending}
          />

          <ChatComposer
            className={styles.composer}
            textareaClassName={styles.input}
            placeholder="Ask something…"
            value={input}
            onChange={setInput}
            onSubmit={submitInput}
            rows={4}
            disabled={sendMsgM.isPending}
            attachments={attachments}
            isUploadingAttachment={isUploadingAttachment}
            uploadingAttachmentName={uploadingAttachmentName}
            attachmentError={attachmentError}
            onAddAttachment={addAttachment}
            onRemoveAttachment={removeAttachment}
          />
        </div>
      </main>
    </div>
  );
}
