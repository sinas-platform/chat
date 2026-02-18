import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

import sinasLogo from "../../icons/sinas-logo.svg";
import { apiClient } from "../../lib/api";
import { getAgentByNamespaceAndName, getSelectedAgent } from "../../lib/agents";
import { useAuth } from "../../lib/authContext";
import { getWorkspaceUrl } from "../../lib/workspace";
import { Button } from "../Button/Button";
import type { Chat } from "../../types";
import styles from "./AppSidebar.module.scss";

type AppSidebarProps = {
  activeChatId?: string;
};

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

function getBadgeToneClass(chat: Chat): string {
  const agent = getAgentByNamespaceAndName(chat.agent_namespace, chat.agent_name);
  if (!agent) return styles.chatBadgeToneNeutral;
  if (agent.tone === "yellow") return styles.chatBadgeToneYellow;
  if (agent.tone === "blue") return styles.chatBadgeToneBlue;
  if (agent.tone === "mint") return styles.chatBadgeToneMint;
  return styles.chatBadgeToneNeutral;
}

function getBadgeLabel(chat: Chat): string {
  const agent = getAgentByNamespaceAndName(chat.agent_namespace, chat.agent_name);
  if (agent) return agent.displayName;
  if (chat.agent_name) return chat.agent_name;
  return "Unknown";
}

export function AppSidebar({ activeChatId }: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const ws = getWorkspaceUrl();

  const [isCreating, setIsCreating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const meQ = useQuery({
    queryKey: ["me", ws],
    queryFn: () => apiClient.me(),
  });

  const chatsQ = useQuery({
    queryKey: ["chats", ws],
    queryFn: () => apiClient.listChats(),
  });

  const chats = chatsQ.data ?? [];
  const isAllChatsPage = location.pathname === "/chats";

  async function onCreateNewChat() {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const selectedAgent = getSelectedAgent();
      const chat = await apiClient.createChatWithAgent(selectedAgent.namespace, selectedAgent.name, {
        title: "New chat",
        input: {},
      });

      navigate(`/chats/${chat.id}`);
    } finally {
      setIsCreating(false);
    }
  }

  async function onLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarTop}>
        <button
          type="button"
          className={styles.sidebarLogoBtn}
          onClick={() => navigate("/")}
          aria-label="Go to homepage"
        >
          <img className={styles.sidebarLogo} src={sinasLogo} alt="Sinas" />
        </button>

        <Button
          variant="minimal"
          className={styles.newChatBtn}
          onClick={onCreateNewChat}
          disabled={isCreating}
        >
          New chat <span aria-hidden>+</span>
        </Button>

        <div className={styles.sidebarSectionTitle}>Your chats</div>

        <div className={styles.chatList}>
          {chatsQ.isLoading ? (
            <div className={styles.muted}>Loading…</div>
          ) : chats.length === 0 ? (
            <div className={styles.muted}>No chats yet</div>
          ) : (
            chats.map((chat: Chat) => (
              <Button
                variant="minimal"
                key={chat.id}
                className={joinClasses(styles.chatRow, chat.id === activeChatId && styles.chatRowActive)}
                onClick={() => navigate(`/chats/${chat.id}`)}
              >
                <span className={styles.chatTitle}>{chat.title ?? "Untitled chat"}</span>
                <span className={joinClasses(styles.chatBadge, getBadgeToneClass(chat))}>{getBadgeLabel(chat)}</span>
              </Button>
            ))
          )}
        </div>

        <Button
          variant="minimal"
          className={joinClasses(styles.allChatsBtn, isAllChatsPage && styles.allChatsBtnActive)}
          onClick={() => navigate("/chats")}
        >
          All chats
        </Button>
      </div>

      <div className={styles.sidebarBottom}>
        <Button variant="minimal" className={styles.settingsBtn} onClick={() => navigate("/settings")}>
          Settings
        </Button>

        <div className={styles.userRow}>
          <Button
            variant="icon"
            className={styles.logoutBtn}
            onClick={onLogout}
            disabled={isLoggingOut}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={16} />
          </Button>
          <div className={styles.userEmail}>{meQ.data?.email ?? "…"}</div>
        </div>
      </div>
    </aside>
  );
}
