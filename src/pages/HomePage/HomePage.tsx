import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import styles from "./HomePage.module.scss";
import sinasLogo from "../../icons/sinas-logo.svg";
import { apiClient } from "../../lib/api";
import { getWorkspaceUrl } from "../../lib/workspace";
import type { Chat } from "../../types";

const DEFAULT_AGENT = {
  namespace: "default",
  name: "futurist agent",
};

function getChatTitleFromDraft(draft: string) {
  const t = draft.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

export default function HomePage() {
  const navigate = useNavigate();
  const ws = getWorkspaceUrl();

  const [messageDraft, setMessageDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const meQ = useQuery({
    queryKey: ["me", ws],
    queryFn: () => apiClient.me(),
  });

  const chatsQ = useQuery({
    queryKey: ["chats", ws],
    queryFn: () => apiClient.listChats(),
  });

  const chats = chatsQ.data ?? [];

  async function createNewChat(initialDraft?: string) {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const draft = (initialDraft ?? "").trim();

      const chat = await apiClient.createChatWithAgent(DEFAULT_AGENT.namespace, DEFAULT_AGENT.name, {
        title: getChatTitleFromDraft(draft),
        input: {},
      });

      navigate(`/chats/${chat.id}`, { state: { initialDraft: draft } });
    } finally {
      setIsCreating(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const draft = messageDraft.trim();
    if (!draft || isCreating) return;
    createNewChat(draft);
    setMessageDraft("");
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();

    const draft = messageDraft.trim();
    if (!draft || isCreating) return;
    createNewChat(draft);
    setMessageDraft("");
  }

  return (
    <div className={styles.homeLayout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <img className={styles.sidebarLogo} src={sinasLogo} alt="Sinas" />

          {/* single New chat button */}
          <button className={styles.newChatBtn} onClick={() => createNewChat("")} disabled={isCreating}>
            New chat <span aria-hidden>+</span>
          </button>

          <div className={styles.sidebarSectionTitle}>Your chats</div>

          <div className={styles.chatList}>
            {chatsQ.isLoading ? (
              <div className={styles.muted}>Loading…</div>
            ) : chats.length === 0 ? (
              <div className={styles.muted}>No chats yet</div>
            ) : (
              chats.map((c: Chat) => (
                <button
                  key={c.id}
                  className={styles.chatRow}
                  onClick={() => navigate(`/chats/${c.id}`)}
                >
                  <span className={styles.chatTitle}>{(c as any).title ?? "Untitled chat"}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={styles.sidebarBottom}>
          <button className={styles.settingsBtn} onClick={() => navigate("/settings")}>
            Settings
          </button>

          <div className={styles.userRow}>
            <div className={styles.userAvatar}>{(meQ.data?.email?.[0] ?? "U").toUpperCase()}</div>
            <div className={styles.userEmail}>{meQ.data?.email ?? "…"}</div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.mainContent}>
          <div className={styles.hero}>
            <div className={styles.heroText}>
              <div className={styles.heroTitle}>Welcome back</div>
              <div className={styles.heroSubtitle}>Start a new conversation.</div>
            </div>
          </div>

          <form className={styles.composer} onSubmit={onSubmit}>
            <textarea
              className={styles.composerInput}
              placeholder="Ask something…"
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={3}
            />
          </form>
        </div>
      </main>
    </div>
  );
}
