import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";

import styles from "./HomePage.module.scss";
import DownArrowIcon from "../../icons/down-arrow.svg?react";
import GridLayoutIcon from "../../icons/grid-layout.svg?react";
import ListLayoutIcon from "../../icons/list-layout.svg?react";
import SearchIcon from "../../icons/search.svg?react";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { ChatComposer } from "../../components/ChatComposer/ChatComposer";
import { DropdownMenu } from "../../components/DropdownMenu/DropdownMenu";
import { Input } from "../../components/Input/Input";
import SinasLoader from "../../components/Loader/Loader";
import { ThemeSwitch } from "../../components/ThemeSwitch/ThemeSwitch";
import { useActiveAgentPreference } from "../../hooks/useActiveAgentPreference";
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import { useVisibleAgentsPreference } from "../../hooks/useVisibleAgentsPreference";
import { apiClient } from "../../lib/api";
import { buildAgentPlaceholderMetaById, type AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import { uploadChatAttachment, UploadChatAttachmentError } from "../../lib/files/filesService";
import type { ChatAttachment } from "../../lib/files/types";
import { getWorkspaceUrl } from "../../lib/workspace";
import {
  CHAT_ATTACHMENT_ACCEPT,
  UNSUPPORTED_AUDIO_ERROR,
  fileToDataUrl,
  isAudioCandidate,
  normalizeAudioFormat,
  stripDataUrlPrefix,
} from "../Chat/chatUtils";
import type { AgentResponse, Chat } from "../../types";

function getChatTitleFromDraft(draft: string) {
  const t = draft.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

const HERO_MESSAGE_INDEX_STORAGE_KEY = "chat.home.hero_message_index";
const HERO_MESSAGE_COUNT = 3;
const RECENT_AGENTS_DISPLAY_LIMIT = 3;
const MOBILE_VIEW_BREAKPOINT_PX = 760;
const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

type AgentSortMode = "alphabetical" | "recent";
type AgentViewMode = "grid" | "list";
type PendingAttachment = {
  file: File;
  preview: ChatAttachment;
};
const DEFAULT_ATTACHMENT_ERROR = "File uploads aren’t configured on this Sinas instance. Ask admin to configure it.";

function getAttachmentErrorMessage(error: unknown): string {
  if (error instanceof UploadChatAttachmentError) {
    if (error.code === "file_too_large") return "File is too large. Max size is 20 MB.";
    if (error.code === "no_permission") return "No permission to upload files";
    return DEFAULT_ATTACHMENT_ERROR;
  }

  if (error instanceof Error) {
    const trimmedMessage = error.message.trim();
    if (trimmedMessage.length > 0) return trimmedMessage;
  }

  return DEFAULT_ATTACHMENT_ERROR;
}

function createLocalAttachment(file: File): ChatAttachment {
  return {
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    url: URL.createObjectURL(file),
    uploaded_at: new Date().toISOString(),
  };
}

function assertAttachmentSizeWithinLimit(file: File) {
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new UploadChatAttachmentError("file_too_large", "File is too large. Max size is 20 MB.");
  }
}

function getLatestChatTimestamp(chat: Chat): number {
  const timestamp = Date.parse(chat.last_message_at ?? chat.updated_at ?? chat.created_at);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function toAgentKey(namespace?: string | null, name?: string | null): string | null {
  if (!namespace || !name) return null;
  return `${namespace.toLowerCase()}::${name.toLowerCase()}`;
}

function getAgentKey(agent: Pick<AgentResponse, "namespace" | "name">): string {
  return `${agent.namespace.toLowerCase()}::${agent.name.toLowerCase()}`;
}

function pickFallbackAgent(agents: AgentResponse[]): AgentResponse | null {
  if (agents.length === 0) return null;

  const backendDefault = agents.find((agent) => agent.is_default);
  if (backendDefault) return backendDefault;

  const sorted = [...agents].sort((left, right) => {
    const leftLabel = `${left.namespace}::${left.name}`;
    const rightLabel = `${right.namespace}::${right.name}`;
    return leftLabel.localeCompare(rightLabel);
  });

  return sorted[0] ?? null;
}

function getNextHeroMessageIndex(): number {
  if (typeof window === "undefined") return 0;

  try {
    const storedRaw = window.localStorage.getItem(HERO_MESSAGE_INDEX_STORAGE_KEY);
    const storedIndex = storedRaw == null ? 0 : Number.parseInt(storedRaw, 10);
    const nextIndex = Number.isNaN(storedIndex) ? 0 : ((storedIndex % HERO_MESSAGE_COUNT) + HERO_MESSAGE_COUNT) % HERO_MESSAGE_COUNT;
    window.localStorage.setItem(HERO_MESSAGE_INDEX_STORAGE_KEY, String((nextIndex + 1) % HERO_MESSAGE_COUNT));
    return nextIndex;
  } catch {
    return 0;
  }
}

type AgentCardProps = {
  agent: AgentResponse;
  isActive: boolean;
  onSelect: (agent: AgentResponse) => void;
  iconSrc?: string;
  placeholder?: AgentPlaceholderMeta;
  onIconError: (agentId: string) => Promise<string | null>;
  className?: string;
};

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

function AgentCard({ agent, isActive, onSelect, iconSrc, placeholder, onIconError, className }: AgentCardProps) {
  const primaryLabel = `${agent.name}`;
  const secondaryLabel = agent.description?.trim() || "No description available.";
  const placeholderCssVars = getPlaceholderCssVars(placeholder);
  const cardCssVars = placeholderCssVars;
  const placeholderGlyphStyle = getPlaceholderGlyphStyle(placeholder);
  const shouldShowPlaceholder = !iconSrc && Boolean(placeholderCssVars);

  return (
    <button
      key={agent.id}
      type="button"
      className={joinClasses(
        styles.agentCard,
        isActive && styles.agentCardActive,
        className,
      )}
      style={cardCssVars}
      onClick={() => onSelect(agent)}
      aria-pressed={isActive}
    >
      <div className={styles.agentCardTop}>
        <span
          className={joinClasses(styles.agentIconWrap, shouldShowPlaceholder && styles.agentIconWrapPlaceholder)}
          aria-hidden
        >
          {iconSrc ? (
            <img
              className={styles.agentIconImage}
              src={iconSrc}
              alt=""
              loading="lazy"
              onError={() => {
                void onIconError(agent.id);
              }}
            />
          ) : shouldShowPlaceholder ? (
            <span className={styles.agentPlaceholderGlyph} style={placeholderGlyphStyle} />
          ) : (
            <Bot size={14} />
          )}
        </span>
        <span className={styles.agentName}>{primaryLabel}</span>
      </div>
      <div className={styles.agentBadge}>{agent.namespace}</div>
      <div className={styles.agentDescription}>{secondaryLabel}</div>
    </button>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const ws = getWorkspaceUrl();
  const hasWorkspaceUrl = ws.length > 0;
  const visibleAgentsPreference = useVisibleAgentsPreference();
  const activeAgentPreference = useActiveAgentPreference();
  const agentsQ = visibleAgentsPreference.agentsQuery;

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [uploadingAttachmentName, setUploadingAttachmentName] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentSort, setAgentSort] = useState<AgentSortMode>("alphabetical");
  const [agentView, setAgentView] = useState<AgentViewMode>("grid");
  const [isMobileView, setIsMobileView] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_VIEW_BREAKPOINT_PX}px)`).matches;
  });
  const [heroMessageIndex, setHeroMessageIndex] = useState(0);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = "Sinas - Chat";
  }, []);

  useEffect(() => {
    return () => {
      pendingAttachmentsRef.current.forEach((attachment) => {
        URL.revokeObjectURL(attachment.preview.url);
      });
    };
  }, []);

  const chatsQ = useQuery({
    queryKey: ["chats", ws],
    queryFn: () => apiClient.listChats(),
    enabled: hasWorkspaceUrl,
  });

  const allActiveAgents = visibleAgentsPreference.activeAgents;
  const activeAgents = visibleAgentsPreference.visibleActiveAgents;
  const { iconSrcByAgentId, onAgentIconError } = useAgentIconSources(activeAgents, apiClient);
  const placeholderByAgentId = useMemo(() => buildAgentPlaceholderMetaById(allActiveAgents), [allActiveAgents]);

  const agentsByKey = useMemo(
    () => new Map(activeAgents.map((agent) => [getAgentKey(agent), agent] as const)),
    [activeAgents],
  );
  const agentsById = useMemo(() => new Map(activeAgents.map((agent) => [agent.id, agent] as const)), [activeAgents]);
  const persistedSelectedAgentId =
    activeAgentPreference.canUsePreferencesState &&
    activeAgentPreference.statesQuery.isSuccess &&
    activeAgentPreference.hasStoredPreference
      ? activeAgentPreference.preference.agentId
      : null;
  const isActiveAgentPreferenceResolved =
    !activeAgentPreference.canUsePreferencesState ||
    activeAgentPreference.statesQuery.isSuccess ||
    activeAgentPreference.statesQuery.isError;

  useEffect(() => {
    // Wait until agents are fully loaded so we do not wipe a persisted selection on first render.
    if (!agentsQ.isSuccess) return;
    if (!isActiveAgentPreferenceResolved) return;
    if (activeAgents.length === 0) {
      if (selectedAgentId !== null) {
        setSelectedAgentId(null);
      }
      return;
    }

    const hasCurrentSelection = selectedAgentId ? agentsById.has(selectedAgentId) : false;
    if (hasCurrentSelection) return;

    const byPreference =
      persistedSelectedAgentId != null ? (agentsById.get(persistedSelectedAgentId) ?? null) : null;
    const defaultAgent = byPreference ?? pickFallbackAgent(activeAgents);
    if (!defaultAgent) return;

    setSelectedAgentId(defaultAgent.id);

    if (
      activeAgentPreference.canUsePreferencesState &&
      (!activeAgentPreference.hasStoredPreference || persistedSelectedAgentId !== defaultAgent.id)
    ) {
      activeAgentPreference.resetSavePreferenceError();
      void activeAgentPreference.savePreference({
        version: 1,
        agentId: defaultAgent.id,
      }).catch(() => {
        // Keep local selection even if preference save fails.
      });
    }
  }, [
    activeAgentPreference,
    activeAgents,
    agentsById,
    agentsByKey,
    selectedAgentId,
    persistedSelectedAgentId,
    agentsQ.isSuccess,
    isActiveAgentPreferenceResolved,
  ]);

  const selectedAgent = useMemo(() => {
    if (activeAgents.length === 0) return null;

    if (selectedAgentId) {
      const byStoredId = agentsById.get(selectedAgentId);
      if (byStoredId) return byStoredId;
    }

    if (persistedSelectedAgentId) {
      const byPreference = agentsById.get(persistedSelectedAgentId);
      if (byPreference) return byPreference;
    }

    return pickFallbackAgent(activeAgents);
  }, [activeAgents, agentsById, selectedAgentId, persistedSelectedAgentId]);

  const selectedAgentIconSrc = selectedAgent ? iconSrcByAgentId[selectedAgent.id] : undefined;
  const selectedAgentPlaceholder = selectedAgent ? placeholderByAgentId[selectedAgent.id] : undefined;
  const selectedAgentPlaceholderCssVars = getPlaceholderCssVars(selectedAgentPlaceholder);
  const selectedAgentPlaceholderGlyphStyle = getPlaceholderGlyphStyle(selectedAgentPlaceholder);
  const shouldShowSelectedAgentPlaceholder = !selectedAgentIconSrc && Boolean(selectedAgentPlaceholderCssVars);
  const selectedAgentName = selectedAgent?.name ?? "an agent";
  const heroMessages = useMemo(
    () => [
      { title: `${selectedAgentName} here.`, hint: "What's on your mind?" },
      { title: `${selectedAgentName} at your service.`, hint: "What are we tackling?" },
      { title: `Hey, I'm ${selectedAgentName}.`, hint: "How can I help?" },
    ],
    [selectedAgentName],
  );

  useEffect(() => {
    setHeroMessageIndex(getNextHeroMessageIndex());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_VIEW_BREAKPOINT_PX}px)`);
    const updateFromMediaQuery = () => setIsMobileView(mediaQuery.matches);
    updateFromMediaQuery();

    mediaQuery.addEventListener("change", updateFromMediaQuery);
    return () => {
      mediaQuery.removeEventListener("change", updateFromMediaQuery);
    };
  }, []);

  const recentAgents = useMemo(() => {
    const chats = [...(chatsQ.data ?? [])];
    chats.sort((left, right) => getLatestChatTimestamp(right) - getLatestChatTimestamp(left));

    const recent: AgentResponse[] = [];
    const seenAgentKeys = new Set<string>();

    for (const chat of chats) {
      const key = toAgentKey(chat.agent_namespace, chat.agent_name);
      if (!key) continue;

      const agent = agentsByKey.get(key);
      if (!agent || seenAgentKeys.has(key)) continue;

      recent.push(agent);
      seenAgentKeys.add(key);
    }

    return recent;
  }, [agentsByKey, chatsQ.data]);

  const recentAgentRank = useMemo(
    () => new Map(recentAgents.map((agent, index) => [getAgentKey(agent), index])),
    [recentAgents],
  );
  const recentAgentsToDisplay = useMemo(
    () => recentAgents.slice(0, RECENT_AGENTS_DISPLAY_LIMIT),
    [recentAgents],
  );

  const normalizedAgentSearch = agentSearch.trim().toLowerCase();
  const agentSortLabel = agentSort === "recent" ? "Recently used" : "Alphabetical";
  const composerAttachments: ChatAttachment[] = useMemo(() => pendingAttachments.map((item) => item.preview), [pendingAttachments]);
  const activeAgentView: AgentViewMode = isMobileView ? "list" : agentView;

  const allAgents = useMemo(() => {
    const filteredAgents = activeAgents.filter((agent) => {
      if (!normalizedAgentSearch) return true;

      const searchable = `${agent.namespace} ${agent.name} ${agent.description ?? ""}`.toLowerCase();
      return searchable.includes(normalizedAgentSearch);
    });

    return filteredAgents.sort((left, right) => {
      if (agentSort === "recent") {
        const leftRank = recentAgentRank.get(getAgentKey(left));
        const rightRank = recentAgentRank.get(getAgentKey(right));

        if (leftRank != null && rightRank != null) return leftRank - rightRank;
        if (leftRank != null) return -1;
        if (rightRank != null) return 1;
      }

      const leftLabel = `${left.namespace} / ${left.name}`;
      const rightLabel = `${right.namespace} / ${right.name}`;
      return leftLabel.localeCompare(rightLabel);
    });
  }, [activeAgents, agentSort, normalizedAgentSearch, recentAgentRank]);

  async function createNewChat(initialDraft?: string, filesToAttach: PendingAttachment[] = []) {
    if (isCreating || !selectedAgent) return;
    setIsCreating(true);

    try {
      const draft = (initialDraft ?? "").trim();

      const chat = await apiClient.createChatWithAgent(selectedAgent.namespace, selectedAgent.name, {
        title: getChatTitleFromDraft(draft),
        input: {},
      });

      const uploadedAttachments: ChatAttachment[] = [];
      const audioContentParts: Array<Record<string, unknown>> = [];
      const uploadedContentParts: Array<Record<string, unknown>> = [];
      if (filesToAttach.length > 0) {
        setAttachmentError(null);
        setIsUploadingAttachment(true);
        const audioAttachments: PendingAttachment[] = [];
        const nonAudioAttachments: PendingAttachment[] = [];

        for (const attachment of filesToAttach) {
          if (isAudioCandidate(attachment.file)) {
            audioAttachments.push(attachment);
            continue;
          }
          nonAudioAttachments.push(attachment);
        }

        for (const attachment of audioAttachments) {
          assertAttachmentSizeWithinLimit(attachment.file);
          const format = normalizeAudioFormat(attachment.file);
          if (!format) {
            throw new Error(UNSUPPORTED_AUDIO_ERROR);
          }

          setUploadingAttachmentName(attachment.file.name);
          const dataUrl = await fileToDataUrl(attachment.file);
          const base64 = stripDataUrlPrefix(dataUrl);

          audioContentParts.push({
            type: "audio",
            data: base64,
            format,
          });
        }

        for (const attachment of nonAudioAttachments) {
          setUploadingAttachmentName(attachment.file.name);
          const uploaded = await uploadChatAttachment(attachment.file, chat.id);
          uploadedAttachments.push(uploaded);

          if (uploaded.mime.toLowerCase().startsWith("image/")) {
            uploadedContentParts.push({ type: "image", image: uploaded.url });
            continue;
          }

          uploadedContentParts.push({
            type: "file",
            file_url: uploaded.url,
            filename: uploaded.name,
            mime_type: uploaded.mime,
          });
        }
      }

      const hasAttachmentParts = audioContentParts.length > 0 || uploadedContentParts.length > 0;
      const initialContent: string | Array<Record<string, unknown>> = hasAttachmentParts
        ? [
            ...(draft ? [{ type: "text", text: draft }] : []),
            ...audioContentParts,
            ...uploadedContentParts,
          ]
        : draft;

      navigate(`/chats/${chat.id}`, {
        state: {
          initialContent,
          initialDraft: draft,
          initialAttachments: uploadedAttachments,
        },
      });
    } finally {
      setIsUploadingAttachment(false);
      setUploadingAttachmentName(null);
      setIsCreating(false);
    }
  }

  function clearPendingAttachments() {
    setPendingAttachments((prev) => {
      prev.forEach((attachment) => {
        URL.revokeObjectURL(attachment.preview.url);
      });
      const next: PendingAttachment[] = [];
      pendingAttachmentsRef.current = next;
      return next;
    });
  }

  async function submitDraft() {
    const draft = messageDraft.trim();
    if ((!draft && pendingAttachments.length === 0) || isCreating || isUploadingAttachment || !selectedAgent) return;

    try {
      await createNewChat(draft, pendingAttachments);
    } catch (error) {
      setAttachmentError(getAttachmentErrorMessage(error));
      return;
    }

    setMessageDraft("");
    clearPendingAttachments();
    setAttachmentError(null);
  }

  function addPendingAttachment(file: File) {
    setAttachmentError(null);
    const preview = createLocalAttachment(file);
    setPendingAttachments((prev) => {
      const next = [...prev, { file, preview }];
      pendingAttachmentsRef.current = next;
      return next;
    });
  }

  function removePendingAttachment(indexToRemove: number) {
    setAttachmentError(null);
    setPendingAttachments((prev) => {
      const target = prev[indexToRemove];
      if (target) {
        URL.revokeObjectURL(target.preview.url);
      }
      const next = prev.filter((_, index) => index !== indexToRemove);
      pendingAttachmentsRef.current = next;
      return next;
    });
  }

  function onSelectAgent(agent: AgentResponse) {
    if (agent.id === selectedAgentId) return;
    setSelectedAgentId(agent.id);
    if (
      activeAgentPreference.canUsePreferencesState &&
      (!activeAgentPreference.hasStoredPreference || persistedSelectedAgentId !== agent.id)
    ) {
      activeAgentPreference.resetSavePreferenceError();
      void activeAgentPreference.savePreference({
        version: 1,
        agentId: agent.id,
      }).catch(() => {
        // Keep local selection even if preference save fails.
      });
    }
    setHeroMessageIndex(getNextHeroMessageIndex());
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const activeHeroMessage = heroMessages[heroMessageIndex] ?? heroMessages[0];
  const hasAgents = activeAgents.length > 0;
  const hasAnyActiveAgents = allActiveAgents.length > 0;
  const isAgentsLoading = agentsQ.isLoading;
  const isAgentsError = agentsQ.isError;
  const isPreferencesError = Boolean(
    visibleAgentsPreference.preferenceReadErrorMessage || activeAgentPreference.preferenceReadErrorMessage,
  );
  const preferencesErrorMessage =
    visibleAgentsPreference.preferenceReadErrorMessage || activeAgentPreference.preferenceReadErrorMessage;
  const canRetryPreferences =
    preferencesErrorMessage != null && preferencesErrorMessage !== "Missing permissions to read/write preferences state";
  const agentLoadErrorMessage =
    agentsQ.error instanceof Error ? agentsQ.error.message : "Could not load agents. Please try again.";

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main ref={mainRef} className={styles.main}>
        <ThemeSwitch className={styles.themeSwitch} />

        <div className={styles.mainContent} style={selectedAgentPlaceholderCssVars}>
          {!hasWorkspaceUrl ? (
            <section className={styles.agentPicker}>
              <div className={styles.agentPickerTitle}>Select workspace</div>
              <div className={styles.errorState} role="alert">
                <span>Workspace URL is not configured. Select a workspace before loading agents.</span>
                <button type="button" className={styles.retryButton} onClick={() => navigate("/login")}>
                  Open workspace selector
                </button>
              </div>
            </section>
          ) : (
            <>
          <div className={styles.hero}>
            <span
              className={joinClasses(
                styles.heroIconWrap,
                selectedAgent ? styles.heroIconWrapPulse : undefined,
                shouldShowSelectedAgentPlaceholder && styles.heroIconWrapPlaceholder,
                selectedAgent && selectedAgentIconSrc ? styles.heroIconWrapCustomIcon : undefined,
              )}
              style={selectedAgentPlaceholderCssVars}
            >
              {selectedAgent && selectedAgentIconSrc ? (
                <img
                  className={styles.heroIconImage}
                  src={selectedAgentIconSrc}
                  alt=""
                  onError={() => {
                    void onAgentIconError(selectedAgent.id);
                  }}
                />
              ) : shouldShowSelectedAgentPlaceholder ? (
                <span className={styles.heroPlaceholderGlyph} style={selectedAgentPlaceholderGlyphStyle} />
              ) : (
                <Bot size={32} />
              )}
            </span>
            <div className={styles.heroText}>
              <div className={styles.heroTitle}>{activeHeroMessage.title}</div>
              <div className={styles.heroHint}>{activeHeroMessage.hint}</div>
            </div>
          </div>

          <ChatComposer
            className={styles.composer}
            textareaClassName={styles.composerInput}
            placeholder={selectedAgent ? `Ask ${selectedAgent.name}…` : "No agents available"}
            value={messageDraft}
            onChange={setMessageDraft}
            onSubmit={submitDraft}
            rows={3}
            disabled={isCreating || isUploadingAttachment || !selectedAgent || isAgentsLoading || isAgentsError}
            attachments={composerAttachments}
            isUploadingAttachment={isUploadingAttachment}
            uploadingAttachmentName={uploadingAttachmentName}
            attachmentError={attachmentError}
            onAddAttachment={addPendingAttachment}
            onRemoveAttachment={removePendingAttachment}
            attachmentAccept={CHAT_ATTACHMENT_ACCEPT}
          />

          <section className={styles.agentPicker}>
            {isPreferencesError ? (
              <div className={styles.errorState} role="alert" style={{ marginBottom: 12 }}>
                <span>{preferencesErrorMessage}</span>
                {(!visibleAgentsPreference.statesQuery.isError && !activeAgentPreference.statesQuery.isError) || !canRetryPreferences ? null : (
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => {
                      void visibleAgentsPreference.statesQuery.refetch();
                      void activeAgentPreference.statesQuery.refetch();
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : null}
            <div className={styles.agentPickerTitle}>Recent agents</div>
            {isAgentsLoading ? (
              <div className={styles.loadingState} role="status" aria-live="polite">
                <SinasLoader size={26} />
                <span className={styles.loadingText}>Loading agents...</span>
              </div>
            ) : isAgentsError ? (
              <div className={styles.errorState} role="alert">
                <span>{agentLoadErrorMessage}</span>
                <button type="button" className={styles.retryButton} onClick={() => void agentsQ.refetch()}>
                  Retry
                </button>
              </div>
            ) : chatsQ.isLoading ? (
              <div className={styles.loadingState} role="status" aria-live="polite">
                <SinasLoader size={26} />
                <span className={styles.loadingText}>Loading recent agents...</span>
              </div>
            ) : !hasAgents ? (
              <div className={styles.muted}>
                {hasAnyActiveAgents ? "All agents are hidden in Homepage Agents settings." : "No agents available"}
              </div>
            ) : recentAgentsToDisplay.length === 0 ? (
              <div className={styles.muted}>No recently used agents yet.</div>
            ) : (
              <div className={styles.recentAgentRow}>
                {recentAgentsToDisplay.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isActive={selectedAgent?.id === agent.id}
                    onSelect={onSelectAgent}
                    iconSrc={iconSrcByAgentId[agent.id]}
                    placeholder={placeholderByAgentId[agent.id]}
                    onIconError={onAgentIconError}
                    className={styles.recentAgentCard}
                  />
                ))}
              </div>
            )}
          </section>

          <section className={styles.allAgentsSection}>
            <div className={styles.allAgentsTitle}>All agents</div>
            <div className={styles.agentControls}>
              <Input
                wrapperClassName={styles.agentSearchField}
                startAction={<SearchIcon className={styles.agentSearchIcon} aria-hidden />}
                className={styles.agentSearchInput}
                type="search"
                placeholder="Search agents..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
              />
              <div className={styles.agentControlActions}>
                {!isMobileView ? (
                  <div className={styles.agentViewToggle} role="group" aria-label="Agent card view mode">
                    <button
                      type="button"
                      className={joinClasses(styles.agentViewBtn, activeAgentView === "list" && styles.agentViewBtnActive)}
                      onClick={() => setAgentView("list")}
                      aria-label="Show agents as list"
                      aria-pressed={activeAgentView === "list"}
                    >
                      <ListLayoutIcon className={styles.agentViewIcon} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={joinClasses(styles.agentViewBtn, activeAgentView === "grid" && styles.agentViewBtnActive)}
                      onClick={() => setAgentView("grid")}
                      aria-label="Show agents as grid"
                      aria-pressed={activeAgentView === "grid"}
                    >
                      <GridLayoutIcon className={styles.agentViewIcon} aria-hidden />
                    </button>
                  </div>
                ) : null}

                <DropdownMenu
                  trigger={
                    <>
                      {agentSortLabel}
                      <DownArrowIcon className={styles.agentSortIcon} aria-hidden />
                    </>
                  }
                  triggerAriaLabel="Sort agents"
                  variant="text"
                  triggerClassName={styles.agentSortTrigger}
                  menuClassName={styles.agentSortMenu}
                  items={[
                    {
                      id: "sort-alphabetical",
                      label: "Alphabetical",
                      onSelect: () => setAgentSort("alphabetical"),
                    },
                    {
                      id: "sort-recent",
                      label: "Recently used",
                      onSelect: () => setAgentSort("recent"),
                    },
                  ]}
                />
              </div>
            </div>

            <div className={joinClasses(styles.allAgentGrid, activeAgentView === "list" && styles.allAgentList)}>
              {isAgentsLoading ? (
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <SinasLoader size={26} />
                  <span className={styles.loadingText}>Loading agents...</span>
                </div>
              ) : isAgentsError ? (
                <div className={styles.errorState} role="alert">
                  <span>{agentLoadErrorMessage}</span>
                  <button type="button" className={styles.retryButton} onClick={() => void agentsQ.refetch()}>
                    Retry
                  </button>
                </div>
              ) : !hasAgents ? (
                <div className={styles.muted}>
                  {hasAnyActiveAgents ? "All agents are hidden in Homepage Agents settings." : "No agents available"}
                </div>
              ) : allAgents.length === 0 ? (
                <div className={styles.muted}>No agents match your search.</div>
              ) : (
                allAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isActive={selectedAgent?.id === agent.id}
                    onSelect={onSelectAgent}
                    iconSrc={iconSrcByAgentId[agent.id]}
                    placeholder={placeholderByAgentId[agent.id]}
                    onIconError={onAgentIconError}
                    className={activeAgentView === "list" ? styles.agentCardList : undefined}
                  />
                ))
              )}
            </div>
          </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
