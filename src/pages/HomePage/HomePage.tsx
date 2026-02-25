import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, LayoutGrid, List, Search, type LucideIcon } from "lucide-react";

import styles from "./HomePage.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { ChatComposer } from "../../components/ChatComposer/ChatComposer";
import { DropdownMenu } from "../../components/DropdownMenu/DropdownMenu";
import SinasLoader from "../../components/Loader/Loader";
import { useVisibleAgentsPreference } from "../../hooks/useVisibleAgentsPreference";
import { apiClient } from "../../lib/api";
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
const AGENT_TONES = ["yellow", "blue", "mint"] as const;

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

function getAgentTone(agent: Pick<AgentResponse, "id" | "namespace" | "name">): (typeof AGENT_TONES)[number] {
  const source = `${agent.id}:${agent.namespace}:${agent.name}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return AGENT_TONES[hash % AGENT_TONES.length] ?? "yellow";
}

type AgentCardProps = {
  agent: AgentResponse;
  isActive: boolean;
  onSelect: (agent: AgentResponse) => void;
  className?: string;
};

function AgentCard({ agent, isActive, onSelect, className }: AgentCardProps) {
  const AgentIcon: LucideIcon = Bot;
  const tone = getAgentTone(agent);
  const primaryLabel = `${agent.namespace} / ${agent.name}`;
  const secondaryLabel = agent.description?.trim() || "No description available.";

  return (
    <button
      key={agent.id}
      type="button"
      className={joinClasses(
        styles.agentCard,
        styles[`agentCardTone${tone[0].toUpperCase()}${tone.slice(1)}`],
        isActive && styles.agentCardActive,
        className,
      )}
      onClick={() => onSelect(agent)}
      aria-pressed={isActive}
    >
      <div className={styles.agentCardTop}>
        <span className={styles.agentIconWrap} aria-hidden>
          <AgentIcon size={14} />
        </span>
        <span className={styles.agentName}>{primaryLabel}</span>
      </div>
      <div className={styles.agentBadge}>{agent.is_default ? "Default" : "Agent"}</div>
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
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

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

  const selectedAgentTone = selectedAgent ? getAgentTone(selectedAgent) : "yellow";

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
    setSelectedAgentKey(key);
    saveSelectedAgentKey(key);
  }

  const selectedAgentDescription = selectedAgent?.description?.trim() || "Select an agent to start a new chat.";
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

      <main className={styles.main}>
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
            <div className={styles.heroText}>
              <div className={styles.heroTitleRow}>
                <span
                  className={joinClasses(
                    styles.heroIconWrap,
                    styles[`heroIconTone${selectedAgentTone[0].toUpperCase()}${selectedAgentTone.slice(1)}`],
                  )}
                >
                  <Bot size={18} />
                </span>
                <div className={styles.heroTitle}>Hello! I&apos;m {selectedAgent ? selectedAgent.name : "an agent"}</div>
              </div>
              <div className={styles.heroHint}>{selectedAgentDescription}</div>
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
                    className={styles.recentAgentCard}
                  />
                ))}
              </div>
            )}
          </section>

          <section className={styles.allAgentsSection}>
            <div className={styles.agentControls}>
              <div className={styles.agentSearchField}>
                <Search size={16} aria-hidden />
                <input
                  className={styles.agentSearchInput}
                  type="search"
                  placeholder="Search agents..."
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                />
              </div>
              <div className={styles.agentControlActions}>
                <div className={styles.agentViewToggle} role="group" aria-label="Agent card view mode">
                  <button
                    type="button"
                    className={joinClasses(styles.agentViewBtn, agentView === "grid" && styles.agentViewBtnActive)}
                    onClick={() => setAgentView("grid")}
                    aria-label="Show agents as grid"
                    aria-pressed={agentView === "grid"}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    type="button"
                    className={joinClasses(styles.agentViewBtn, agentView === "list" && styles.agentViewBtnActive)}
                    onClick={() => setAgentView("list")}
                    aria-label="Show agents as list"
                    aria-pressed={agentView === "list"}
                  >
                    <List size={14} />
                  </button>
                </div>

                <DropdownMenu
                  trigger={
                    <>
                      {agentSortLabel}
                      <ChevronDown size={14} />
                    </>
                  }
                  triggerAriaLabel="Sort agents"
                  variant="text"
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
