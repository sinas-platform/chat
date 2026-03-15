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
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import { useVisibleAgentsPreference } from "../../hooks/useVisibleAgentsPreference";
import { apiClient } from "../../lib/api";
import { buildAgentPlaceholderMetaById, type AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import { uploadChatAttachment, UploadChatAttachmentError } from "../../lib/files/filesService";
import type { ChatAttachment } from "../../lib/files/types";
import { getWorkspaceUrl } from "../../lib/workspace";
import type { AgentResponse, Chat } from "../../types";

function getChatTitleFromDraft(draft: string) {
  const t = draft.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

const SELECTED_AGENT_STORAGE_KEY = "chat.selected_agent_endpoint";
const HERO_MESSAGE_INDEX_STORAGE_KEY = "chat.home.hero_message_index";
const HERO_MESSAGE_COUNT = 3;

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

function toUploadAttachmentError(error: unknown): UploadChatAttachmentError {
  if (error instanceof UploadChatAttachmentError) return error;
  return new UploadChatAttachmentError("not_configured", DEFAULT_ATTACHMENT_ERROR);
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

function readSelectedAgentKey(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(SELECTED_AGENT_STORAGE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function saveSelectedAgentKey(agentKey: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SELECTED_AGENT_STORAGE_KEY, agentKey);
  } catch {
    // Ignore storage failures; in-memory selection is still fine.
  }
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
  const agentsQ = visibleAgentsPreference.agentsQuery;

  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(() => readSelectedAgentKey());
  const [messageDraft, setMessageDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [uploadingAttachmentName, setUploadingAttachmentName] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentSort, setAgentSort] = useState<AgentSortMode>("alphabetical");
  const [agentView, setAgentView] = useState<AgentViewMode>("grid");
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

  useEffect(() => {
    if (activeAgents.length === 0) {
      if (selectedAgentKey !== null) {
        setSelectedAgentKey(null);
      }
      return;
    }

    const hasCurrentSelection = selectedAgentKey ? agentsByKey.has(selectedAgentKey) : false;
    if (hasCurrentSelection) return;

    const defaultAgent = activeAgents.find((agent) => agent.is_default) ?? activeAgents[0];
    if (!defaultAgent) return;

    const nextKey = getAgentKey(defaultAgent);
    setSelectedAgentKey(nextKey);
    saveSelectedAgentKey(nextKey);
  }, [activeAgents, agentsByKey, selectedAgentKey]);

  const selectedAgent = useMemo(() => {
    if (activeAgents.length === 0) return null;

    if (selectedAgentKey) {
      const byStoredKey = agentsByKey.get(selectedAgentKey);
      if (byStoredKey) return byStoredKey;
    }

    return activeAgents.find((agent) => agent.is_default) ?? activeAgents[0] ?? null;
  }, [activeAgents, agentsByKey, selectedAgentKey]);

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

  const normalizedAgentSearch = agentSearch.trim().toLowerCase();
  const agentSortLabel = agentSort === "recent" ? "Recently used" : "Alphabetical";
  const composerAttachments: ChatAttachment[] = useMemo(() => pendingAttachments.map((item) => item.preview), [pendingAttachments]);

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
      if (filesToAttach.length > 0) {
        setAttachmentError(null);
        setIsUploadingAttachment(true);
        try {
          for (const attachment of filesToAttach) {
            setUploadingAttachmentName(attachment.file.name);
            const uploaded = await uploadChatAttachment(attachment.file, chat.id);
            uploadedAttachments.push(uploaded);
          }
        } catch (error) {
          const uploadError = toUploadAttachmentError(error);
          throw uploadError;
        }
      }

      navigate(`/chats/${chat.id}`, { state: { initialDraft: draft, initialAttachments: uploadedAttachments } });
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
    const key = getAgentKey(agent);
    if (key === selectedAgentKey) return;
    setSelectedAgentKey(key);
    saveSelectedAgentKey(key);
    setHeroMessageIndex(getNextHeroMessageIndex());
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const activeHeroMessage = heroMessages[heroMessageIndex] ?? heroMessages[0];
  const hasAgents = activeAgents.length > 0;
  const hasAnyActiveAgents = allActiveAgents.length > 0;
  const isAgentsLoading = agentsQ.isLoading;
  const isAgentsError = agentsQ.isError;
  const isPreferencesError = Boolean(visibleAgentsPreference.preferenceReadErrorMessage);
  const agentLoadErrorMessage =
    agentsQ.error instanceof Error ? agentsQ.error.message : "Could not load agents. Please try again.";

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main ref={mainRef} className={styles.main}>
        <ThemeSwitch className={styles.themeSwitch} />

        <div className={styles.mainContent}>
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
          />

          <section className={styles.agentPicker}>
            {isPreferencesError ? (
              <div className={styles.errorState} role="alert" style={{ marginBottom: 12 }}>
                <span>{visibleAgentsPreference.preferenceReadErrorMessage}</span>
                {!visibleAgentsPreference.statesQuery.isError ||
                visibleAgentsPreference.preferenceReadErrorMessage ===
                  "Missing permissions to read/write preferences state" ? null : (
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => void visibleAgentsPreference.statesQuery.refetch()}
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
            ) : recentAgents.length === 0 ? (
              <div className={styles.muted}>No recently used agents yet.</div>
            ) : (
              <div className={styles.recentAgentRow}>
                {recentAgents.map((agent) => (
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
                <div className={styles.agentViewToggle} role="group" aria-label="Agent card view mode">
                  <button
                    type="button"
                    className={joinClasses(styles.agentViewBtn, agentView === "list" && styles.agentViewBtnActive)}
                    onClick={() => setAgentView("list")}
                    aria-label="Show agents as list"
                    aria-pressed={agentView === "list"}
                  >
                    <ListLayoutIcon className={styles.agentViewIcon} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={joinClasses(styles.agentViewBtn, agentView === "grid" && styles.agentViewBtnActive)}
                    onClick={() => setAgentView("grid")}
                    aria-label="Show agents as grid"
                    aria-pressed={agentView === "grid"}
                  >
                    <GridLayoutIcon className={styles.agentViewIcon} aria-hidden />
                  </button>
                </div>

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

            <div className={joinClasses(styles.allAgentGrid, agentView === "list" && styles.allAgentList)}>
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
                    className={agentView === "list" ? styles.agentCardList : undefined}
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
