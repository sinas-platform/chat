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

type AudioAttachmentFormat = "wav" | "mp3" | "m4a" | "ogg";

type LocationState = {
  initialDraft?: string;
  initialAttachments?: ChatAttachment[];
};

type SendMessageVariables = {
  content: string | Array<Record<string, unknown>>;
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

const MARKDOWN_PLUGINS = [remarkGfm];
const MemoizedAppSidebar = memo(AppSidebar);
const DEFAULT_ATTACHMENT_ERROR = "File uploads aren’t configured on this Sinas instance. Ask admin to configure it.";
// Keep audio attachment plumbing in place; flip to `true` once agents support audio parts.
const AUDIO_ATTACHMENTS_ENABLED = false;
const AUDIO_ATTACHMENTS_DISABLED_ERROR = "Audio attachments are not supported yet.";
const UNSUPPORTED_AUDIO_ERROR = "Unsupported audio format. Please use WAV, MP3, M4A, or OGG.";
const SUPPORTED_AUDIO_FORMATS = new Set<AudioAttachmentFormat>(["wav", "mp3", "m4a", "ogg"]);

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

type ChatMessageRowProps = {
  message: ChatMessageViewModel;
  showAssistantAvatarLoading?: boolean;
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

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  showAssistantAvatarLoading = false,
}: ChatMessageRowProps) {
  const { text: messageText, attachments } = parseMessageContent(message.content);
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");
  const audioAttachments = attachments.filter((attachment) => attachment.kind === "audio");
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
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [uploadingAttachmentName, setUploadingAttachmentName] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const sentInitialDraftRef = useRef<Record<string, boolean>>({});
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
        const nextUserMsg: any = {
          id: vars.userTempId,
          role: "user",
          content: vars.content,
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
      assistantTempId: `tmp-assistant-${ts}`,
    });
  }, [chatId, initialDraft, initialAttachments, chatQ.isLoading, chatQ.isError, sendMsgM]);

  async function addAttachment(file: File) {
    if (!chatId || isUploadingAttachment || sendMsgM.isPending) return;

    setAttachmentError(null);
    setIsUploadingAttachment(true);
    setUploadingAttachmentName(file.name);

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
    }
  }

  function removeAttachment(indexToRemove: number) {
    setAttachmentError(null);
    setPendingAttachments((prev) => prev.filter((_, index) => index !== indexToRemove));
  }

  function submitInput() {
    const trimmed = input.trim();
    if (sendMsgM.isPending || isUploadingAttachment) return;
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
    sendMsgM.mutate({
      content,
      userTempId: `tmp-user-${ts}`,
      assistantTempId: `tmp-assistant-${ts}`,
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
            attachments={composerAttachments}
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
