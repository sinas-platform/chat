import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, LogOut, Settings } from "lucide-react";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  useHover,
  useInteractions,
} from "@floating-ui/react";

import sinasLogo from "../../icons/sinas-logo.svg";
import plusIcon from "../../icons/plus.svg";
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import { apiClient } from "../../lib/api";
import { buildAgentPlaceholderMetaById, type AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import { useAuth } from "../../lib/authContext";
import { getApplicationId, getWorkspaceUrl } from "../../lib/workspace";
import type { AgentResponse, Chat } from "../../types";
import { Button } from "../Button/Button";
import SinasLoader from "../Loader/Loader";
import styles from "./AppSidebar.module.scss";

type AppSidebarProps = {
  activeChatId?: string;
};

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

function toAgentKey(namespace?: string | null, name?: string | null): string | null {
  if (!namespace || !name) return null;
  return `${namespace.toLowerCase()}::${name.toLowerCase()}`;
}

function getAgentKey(agent: Pick<AgentResponse, "namespace" | "name">): string {
  return `${agent.namespace.toLowerCase()}::${agent.name.toLowerCase()}`;
}

function getPlaceholderCssVars(placeholder: AgentPlaceholderMeta | undefined): CSSProperties | undefined {
  if (!placeholder) return undefined;

  return {
    "--agent-icon-color": placeholder.color,
    "--agent-icon-soft-color": placeholder.softColor,
  } as CSSProperties;
}

function getPlaceholderGlyphStyle(placeholder: AgentPlaceholderMeta | undefined): CSSProperties | undefined {
  if (!placeholder) return undefined;

  const iconUrl = `url("${placeholder.iconSrc}")`;
  return {
    WebkitMaskImage: iconUrl,
    maskImage: iconUrl,
  } as CSSProperties;
}

type ChatAgentIconProps = {
  chat: Chat;
  agentsById: Map<string, AgentResponse>;
  agentsByKey: Map<string, AgentResponse>;
  iconSrcByAgentId: Record<string, string>;
  placeholderByAgentId: Record<string, AgentPlaceholderMeta>;
  onAgentIconError: (agentId: string) => Promise<string | null>;
};

function ChatAgentIcon({
  chat,
  agentsById,
  agentsByKey,
  iconSrcByAgentId,
  placeholderByAgentId,
  onAgentIconError,
}: ChatAgentIconProps) {
  let chatAgent = chat.agent_id ? agentsById.get(chat.agent_id) : undefined;
  if (!chatAgent) {
    const endpointKey = toAgentKey(chat.agent_namespace, chat.agent_name);
    chatAgent = endpointKey ? agentsByKey.get(endpointKey) : undefined;
  }

  const iconSrc = chatAgent ? iconSrcByAgentId[chatAgent.id] : undefined;
  const placeholder = chatAgent ? placeholderByAgentId[chatAgent.id] : undefined;
  const placeholderCssVars = getPlaceholderCssVars(placeholder);
  const shouldShowPlaceholder = !iconSrc && Boolean(placeholderCssVars);
  const placeholderGlyphStyle = getPlaceholderGlyphStyle(placeholder);

  return (
    <span
      className={joinClasses(styles.chatAgentIconWrap, shouldShowPlaceholder && styles.chatAgentIconWrapPlaceholder)}
      style={shouldShowPlaceholder ? placeholderCssVars : undefined}
      aria-hidden
    >
      {iconSrc && chatAgent ? (
        <img
          className={styles.chatAgentIconImage}
          src={iconSrc}
          alt=""
          loading="lazy"
          onError={() => {
            void onAgentIconError(chatAgent.id);
          }}
        />
      ) : shouldShowPlaceholder ? (
        <span className={styles.chatAgentPlaceholderGlyph} style={placeholderGlyphStyle} />
      ) : (
        <Bot size={14} />
      )}
    </span>
  );
}

function SidebarChatTitle({ title }: { title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [referenceEl, setReferenceEl] = useState<HTMLSpanElement | null>(null);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    whileElementsMounted: autoUpdate,
    placement: "right",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { move: false, enabled: isTruncated });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);
  const setTitleRef = useCallback(
    (node: HTMLSpanElement | null) => {
      refs.setReference(node);
      setReferenceEl(node);
    },
    [refs],
  );

  useEffect(() => {
    if (!referenceEl) {
      setIsTruncated(false);
      return;
    }

    const checkTruncation = () => {
      setIsTruncated(referenceEl.scrollWidth > referenceEl.clientWidth);
    };

    checkTruncation();

    const resizeObserver = new ResizeObserver(checkTruncation);
    resizeObserver.observe(referenceEl);
    window.addEventListener("resize", checkTruncation);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkTruncation);
    };
  }, [referenceEl, title]);

  useEffect(() => {
    if (!isTruncated && isOpen) {
      setIsOpen(false);
    }
  }, [isTruncated, isOpen]);

  return (
    <>
      <span ref={setTitleRef} className={styles.chatTitle} {...getReferenceProps()}>
        {title}
      </span>
      {isTruncated && isOpen ? (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} className={styles.chatTitleTooltip} {...getFloatingProps()}>
            {title}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export function AppSidebar({ activeChatId }: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const ws = getWorkspaceUrl();
  const appId = getApplicationId();

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const meQ = useQuery({
    queryKey: ["me", ws],
    queryFn: () => apiClient.me(),
    enabled: Boolean(ws),
  });

  const chatsQ = useQuery({
    queryKey: ["chats", ws],
    queryFn: () => apiClient.listChats(),
    enabled: Boolean(ws),
  });

  const agentsQ = useQuery({
    queryKey: ["config-agents", ws, appId ?? ""],
    queryFn: () => apiClient.listAgents(appId),
    enabled: Boolean(ws),
  });

  const activeAgents = useMemo(() => (agentsQ.data ?? []).filter((agent) => agent.is_active), [agentsQ.data]);
  const { iconSrcByAgentId, onAgentIconError } = useAgentIconSources(activeAgents, apiClient);
  const placeholderByAgentId = useMemo(() => buildAgentPlaceholderMetaById(activeAgents), [activeAgents]);
  const agentsById = useMemo(() => new Map(activeAgents.map((agent) => [agent.id, agent] as const)), [activeAgents]);
  const agentsByKey = useMemo(
    () => new Map(activeAgents.map((agent) => [getAgentKey(agent), agent] as const)),
    [activeAgents],
  );

  const chats = chatsQ.data ?? [];
  const isAllChatsPage = location.pathname === "/chats";
  const isSettingsPage = location.pathname === "/settings";

  function onCreateNewChat() {
    navigate("/");
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
        <div className={styles.sidebarLogoWrap}>
          <img className={styles.sidebarLogo} src={sinasLogo} alt="Sinas" />
        </div>

        <Button
          variant="minimal"
          className={styles.newChatBtn}
          onClick={onCreateNewChat}
        >
          <img className={styles.newChatIcon} src={plusIcon} alt="" aria-hidden />
          <span>New chat</span>
        </Button>

        <div className={styles.sidebarSectionTitle}>Your chats</div>

        <div className={styles.chatList}>
          {chatsQ.isLoading ? (
            <div className={styles.loadingState} role="status" aria-live="polite">
              <SinasLoader size={22} />
              <span className={styles.loadingText}>Loading chats...</span>
            </div>
          ) : chats.length === 0 ? (
            <div className={styles.muted}>No chats yet</div>
          ) : (
            chats.map((chat) => {
              const chatTitle = chat.title?.trim() || "Untitled chat";
              return (
                <Button
                  variant="minimal"
                  key={chat.id}
                  className={joinClasses(styles.chatRow, chat.id === activeChatId && styles.chatRowActive)}
                  onClick={() => navigate(`/chats/${chat.id}`)}
                >
                  <ChatAgentIcon
                    chat={chat}
                    agentsById={agentsById}
                    agentsByKey={agentsByKey}
                    iconSrcByAgentId={iconSrcByAgentId}
                    placeholderByAgentId={placeholderByAgentId}
                    onAgentIconError={onAgentIconError}
                  />
                  <SidebarChatTitle title={chatTitle} />
                </Button>
              );
            })
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
        <Button
          variant="minimal"
          className={joinClasses(styles.settingsBtn, isSettingsPage && styles.settingsBtnActive)}
          onClick={() => navigate("/settings")}
        >
          <Settings size={16} aria-hidden />
          <span>Settings</span>
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
