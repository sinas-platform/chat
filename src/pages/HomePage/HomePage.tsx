import { useState } from "react";
import { useNavigate } from "react-router-dom";

import styles from "./HomePage.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { apiClient } from "../../lib/api";

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

  const [messageDraft, setMessageDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);

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
    <div className={styles.layout}>
      <AppSidebar />

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
