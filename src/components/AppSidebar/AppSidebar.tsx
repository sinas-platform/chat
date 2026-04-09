import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from "@floating-ui/react";

import sinasLogoLightFilled from "../../icons/sinas-logo-light-filled.svg";
import sinasLogoDarkFilled from "../../icons/sinas-logo-dark-filled.svg";
import PlusIcon from "../../icons/plus.svg?react";
import LinkIcon from "../../icons/link.svg?react";
import SettingsIcon from "../../icons/settings.svg?react";
import LogoutIcon from "../../icons/logout.svg?react";
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import { apiClient } from "../../lib/api";
import { buildAgentPlaceholderMetaById, type AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import { useAuth } from "../../lib/authContext";
import { useTheme } from "../../lib/useTheme";
import { getApplicationId, getWorkspaceUrl } from "../../lib/workspace";
import type { AgentResponse, Chat } from "../../types";
import { Button } from "../Button/Button";
import SinasLoader from "../Loader/Loader";
import { ThemeSwitch } from "../ThemeSwitch/ThemeSwitch";
import styles from "./AppSidebar.module.scss";

type AppSidebarProps = {
  activeChatId?: string;
};

const SIDEBAR_CHAT_LIMIT = 10;
const MOBILE_SIDEBAR_BREAKPOINT = 760;

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`).matches;
}

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

function getChatSortTime(chat: Chat): number {
  const timestamp = Date.parse(chat.last_message_at ?? chat.updated_at ?? chat.created_at);
  return Number.isNaN(timestamp) ? 0 : timestamp;
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
  const { logout } = useAuth();
  const { theme } = useTheme();
  const ws = getWorkspaceUrl();
  const appId = getApplicationId();
  const logoSrc = theme === "dark" ? sinasLogoLightFilled : sinasLogoDarkFilled;

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isLogoutTooltipOpen, setIsLogoutTooltipOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(isMobileViewport);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { refs: logoutTooltipRefs, floatingStyles: logoutTooltipStyles, context: logoutTooltipContext } = useFloating({
    open: isLogoutTooltipOpen,
    onOpenChange: setIsLogoutTooltipOpen,
    whileElementsMounted: autoUpdate,
    placement: "top",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const logoutHover = useHover(logoutTooltipContext, { move: false, enabled: !isLoggingOut });
  const logoutFocus = useFocus(logoutTooltipContext, { enabled: !isLoggingOut });
  const { getReferenceProps: getLogoutReferenceProps, getFloatingProps: getLogoutFloatingProps } = useInteractions([
    logoutHover,
    logoutFocus,
  ]);

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
  const sidebarChats = useMemo(() => {
    return [...chats]
      .sort((a, b) => getChatSortTime(b) - getChatSortTime(a))
      .slice(0, SIDEBAR_CHAT_LIMIT);
  }, [chats]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`);
    const handleChange = () => {
      const nextIsMobile = mediaQuery.matches;
      setIsMobile(nextIsMobile);

      if (!nextIsMobile) {
        setIsMobileSidebarOpen(false);
      }
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (!isMobile || !isMobileSidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, isMobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;

    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, [isMobileSidebarOpen]);

  function closeMobileSidebar() {
    setIsMobileSidebarOpen(false);
  }

  function toggleMobileSidebar() {
    setIsMobileSidebarOpen((current) => !current);
  }

  function navigateWithMobileClose(path: string) {
    closeMobileSidebar();
    navigate(path);
  }

  function onCreateNewChat() {
    navigateWithMobileClose("/");
  }

  async function onLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      closeMobileSidebar();
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <>
      {isMobile ? (
        <div className={styles.mobileTopBar}>
          <button
            type="button"
            className={styles.mobileSidebarToggle}
            onClick={toggleMobileSidebar}
            aria-label={isMobileSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={isMobileSidebarOpen}
            aria-controls="app-sidebar-panel"
          >
            {isMobileSidebarOpen ? (
              <PanelLeftClose className={styles.mobileSidebarToggleIcon} aria-hidden />
            ) : (
              <PanelLeftOpen className={styles.mobileSidebarToggleIcon} aria-hidden />
            )}
          </button>

          <ThemeSwitch
            compact
            pinToViewportOnMobile={false}
            className={styles.mobileTopBarThemeSwitch}
          />
        </div>
      ) : null}

      {isMobile ? (
        <button
          type="button"
          className={joinClasses(styles.mobileBackdrop, !isMobileSidebarOpen && styles.mobileBackdropHidden)}
          onClick={closeMobileSidebar}
          aria-label="Close sidebar"
          tabIndex={isMobileSidebarOpen ? 0 : -1}
        />
      ) : null}

      <aside
        id="app-sidebar-panel"
        className={joinClasses(styles.sidebar, isMobileSidebarOpen && styles.sidebarOpen)}
        aria-hidden={isMobile ? !isMobileSidebarOpen : undefined}
      >
        <div className={styles.sidebarTop}>
          <div className={styles.sidebarLogoWrap}>
            <img className={styles.sidebarLogo} src={logoSrc} alt="Sinas" />
          </div>

          <Button
            variant="minimal"
            className={styles.newChatBtn}
            onClick={onCreateNewChat}
          >
            <PlusIcon className={styles.newChatIcon} aria-hidden />
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
              sidebarChats.map((chat) => {
                const chatTitle = chat.title?.trim() || "Untitled chat";
                return (
                  <Button
                    variant="minimal"
                    key={chat.id}
                    className={joinClasses(styles.chatRow, chat.id === activeChatId && styles.chatRowActive)}
                    onClick={() => navigateWithMobileClose(`/chats/${chat.id}`)}
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
            className={styles.allChatsBtn}
            onClick={() => navigateWithMobileClose("/chats")}
          >
            <LinkIcon className={styles.allChatsIcon} aria-hidden />
            <span>All chats</span>
          </Button>

        </div>

        <div className={styles.sidebarBottom}>
          <Button
            variant="minimal"
            className={styles.settingsBtn}
            onClick={() => navigateWithMobileClose("/settings")}
          >
            <SettingsIcon className={styles.settingsIcon} aria-hidden />
            <span>Settings</span>
          </Button>

          <div className={styles.userRow}>
            <Button
              variant="icon"
              className={styles.logoutBtn}
              ref={logoutTooltipRefs.setReference}
              {...getLogoutReferenceProps()}
              onClick={onLogout}
              disabled={isLoggingOut}
              aria-label="Log out"
            >
              <LogoutIcon className={styles.logoutIcon} aria-hidden />
            </Button>
            {isLogoutTooltipOpen ? (
              <FloatingPortal>
                <div
                  ref={logoutTooltipRefs.setFloating}
                  style={logoutTooltipStyles}
                  className={styles.iconTooltip}
                  {...getLogoutFloatingProps()}
                >
                  Log out
                </div>
              </FloatingPortal>
            ) : null}
            <div className={styles.userEmail}>{meQ.data?.email ?? "…"}</div>
          </div>
        </div>
      </aside>
    </>
  );
}
