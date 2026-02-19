import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./Chat.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { ChatComposer } from "../../components/ChatComposer/ChatComposer";
import { apiClient } from "../../lib/api";
import type { Message } from "../../types";

type LocationState = {
  initialDraft?: string;
};

function getMessageText(content: unknown): string {
  if (typeof content === "string") return content;
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

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();

  const initialDraft = useMemo(() => {
    const state = location.state as LocationState | null;
    return state?.initialDraft?.trim() ?? "";
  }, [location.state]);

  const [input, setInput] = useState("");
  const sentInitialDraftRef = useRef<Record<string, boolean>>({});

  const chatQ = useQuery({
    queryKey: ["chat", chatId],
    enabled: !!chatId,
    queryFn: async () => apiClient.getChat(chatId!),
  });

  const messages: Message[] = useMemo(() => {
    const data: any = chatQ.data;
    if (!data) return [];
    return Array.isArray(data.messages) ? (data.messages as Message[]) : [];
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
    mutationFn: async (content: string) => {
      if (!chatId) throw new Error("Missing chatId");
      return apiClient.sendMessage(chatId, { content });
    },
    onMutate: async (content: string) => {
      if (!chatId) return;

      // Cancel in-flight chat query so we don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["chat", chatId] });

      // Snapshot previous value
      const previous = queryClient.getQueryData<any>(["chat", chatId]);

      // Optimistically add the user message
      queryClient.setQueryData(["chat", chatId], (old: any) => {
        if (!old) return old;
        const nextMsg: any = {
          id: `tmp-${Date.now()}`,
          role: "user",
          content,
          created_at: new Date().toISOString(),
        };
        const oldMsgs = Array.isArray(old.messages) ? old.messages : [];
        return { ...old, messages: [...oldMsgs, nextMsg] };
      });

      return { previous };
    },
    onError: (_err, _content, ctx) => {
      if (!chatId) return;
      // Roll back optimistic update
      if (ctx?.previous) queryClient.setQueryData(["chat", chatId], ctx.previous);
    },
    onSuccess: () => {
      if (!chatId) return;
      // Refetch chat so we get the server message + assistant response
      queryClient.invalidateQueries({ queryKey: ["chat", chatId] });
    },
  });

  // Auto-send initial draft once
  useEffect(() => {
    if (!chatId) return;
    if (!initialDraft) return;
    if (chatQ.isLoading || chatQ.isError) return;

    if (sentInitialDraftRef.current[chatId]) return;
    sentInitialDraftRef.current[chatId] = true;

    sendMsgM.mutate(initialDraft);
    setInput("");
  }, [chatId, initialDraft, chatQ.isLoading, chatQ.isError, sendMsgM]);

  function submitInput() {
    const trimmed = input.trim();
    if (!trimmed || sendMsgM.isPending) return;
    sendMsgM.mutate(trimmed);
    setInput("");
  }

  if (!chatId) {
    return (
      <div className={styles.layout}>
        <AppSidebar />
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
      <AppSidebar activeChatId={chatId} />
      <main className={styles.main}>
        <div className={styles.chatShell}>
          <div className={styles.messages}>
            {chatQ.isError ? <div className={styles.error}>Could not load chat</div> : null}

            {!chatQ.isLoading && messages.length === 0 ? (
              <div className={styles.empty}>No messages yet</div>
            ) : (
              messages.map((m: any) => {
                const messageText = getMessageText(m.content);
                return (
                  <div
                    key={m.id ?? `${m.role}-${m.created_at}-${messageText.slice(0, 20)}`}
                    className={`${styles.message} ${m.role === "user" ? styles.userMsg : styles.assistantMsg}`}
                  >
                    <div className={styles.messageRole}>{m.role ?? "assistant"}</div>
                    <div className={styles.messageBody}>
                      {m.role === "assistant" ? (
                        <div className={styles.messageMarkdown}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{messageText}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className={styles.messageText}>{messageText}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {sendMsgM.isPending ? <div className={styles.muted}>Sending…</div> : null}
          </div>

          <ChatComposer
            className={styles.composer}
            textareaClassName={styles.input}
            placeholder="Ask something…"
            value={input}
            onChange={setInput}
            onSubmit={submitInput}
            rows={4}
            disabled={sendMsgM.isPending}
          />
        </div>
      </main>
    </div>
  );
}
