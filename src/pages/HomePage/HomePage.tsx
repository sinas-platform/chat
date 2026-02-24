import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, LayoutGrid, Lightbulb, List, Newspaper, Search, type LucideIcon } from "lucide-react";

import styles from "./HomePage.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { ChatComposer } from "../../components/ChatComposer/ChatComposer";
import { DropdownMenu } from "../../components/DropdownMenu/DropdownMenu";
import SinasLoader from "../../components/Loader/Loader";
import { apiClient } from "../../lib/api";
import { uploadChatAttachment, UploadChatAttachmentError } from "../../lib/files/filesService";
import type { ChatAttachment } from "../../lib/files/types";
import {
  AGENT_OPTIONS,
  getAgentById,
  getDefaultAgent,
  getSelectedAgent,
  saveSelectedAgentId,
  type AgentOption,
} from "../../lib/agents";
import { getWorkspaceUrl } from "../../lib/workspace";
import type { Chat } from "../../types";

function getChatTitleFromDraft(draft: string) {
  const t = draft.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

const AGENT_ICONS: Record<string, LucideIcon> = {
  "mistral-test-nl": Bot,
  "futurist-agent": Lightbulb,
  "pulsr-news-editor": Newspaper,
};

const AGENT_BY_ENDPOINT_KEY = new Map(
  AGENT_OPTIONS.map((agent) => [`${agent.namespace}::${agent.name}`, agent] as const),
);

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

type AgentCardProps = {
  agent: AgentOption;
  isActive: boolean;
  onSelect: (agentId: string) => void;
  className?: string;
};

function AgentCard({ agent, isActive, onSelect, className }: AgentCardProps) {
  const AgentIcon = AGENT_ICONS[agent.id] ?? Bot;

  return (
    <button
      key={agent.id}
      type="button"
      className={joinClasses(
        styles.agentCard,
        styles[`agentCardTone${agent.tone[0].toUpperCase()}${agent.tone.slice(1)}`],
        isActive && styles.agentCardActive,
        className,
      )}
      onClick={() => onSelect(agent.id)}
      aria-pressed={isActive}
    >
      <div className={styles.agentCardTop}>
        <span className={styles.agentIconWrap} aria-hidden>
          <AgentIcon size={14} />
        </span>
        <span className={styles.agentName}>{agent.displayName}</span>
      </div>
      <div className={styles.agentBadge}>{agent.namespace}</div>
      <div className={styles.agentDescription}>{agent.description}</div>
    </button>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const ws = getWorkspaceUrl();

  const [selectedAgentId, setSelectedAgentId] = useState(() => getSelectedAgent().id);
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
  });

  const selectedAgent = useMemo(
    () => getAgentById(selectedAgentId) ?? getDefaultAgent(),
    [selectedAgentId],
  );
  const SelectedAgentIcon = AGENT_ICONS[selectedAgent.id] ?? Bot;

  const recentAgents = useMemo(() => {
    const chats = [...(chatsQ.data ?? [])];
    chats.sort((left, right) => getLatestChatTimestamp(right) - getLatestChatTimestamp(left));

    const recent: AgentOption[] = [];
    const seenAgentIds = new Set<string>();

    for (const chat of chats) {
      if (!chat.agent_namespace || !chat.agent_name) continue;

      const agent = AGENT_BY_ENDPOINT_KEY.get(`${chat.agent_namespace}::${chat.agent_name}`);
      if (!agent || seenAgentIds.has(agent.id)) continue;

      recent.push(agent);
      seenAgentIds.add(agent.id);
    }

    return recent;
  }, [chatsQ.data]);

  const recentAgentRank = useMemo(
    () => new Map(recentAgents.map((agent, index) => [agent.id, index])),
    [recentAgents],
  );

  const normalizedAgentSearch = agentSearch.trim().toLowerCase();
  const agentSortLabel = agentSort === "recent" ? "Recently used" : "Alphabetical";
  const composerAttachments: ChatAttachment[] = useMemo(() => pendingAttachments.map((item) => item.preview), [pendingAttachments]);

  const allAgents = useMemo(() => {
    const filteredAgents = AGENT_OPTIONS.filter((agent) => {
      if (!normalizedAgentSearch) return true;

      const searchable = `${agent.displayName} ${agent.name} ${agent.namespace} ${agent.description}`.toLowerCase();
      return searchable.includes(normalizedAgentSearch);
    });

    return filteredAgents.sort((left, right) => {
      if (agentSort === "recent") {
        const leftRank = recentAgentRank.get(left.id);
        const rightRank = recentAgentRank.get(right.id);

        if (leftRank != null && rightRank != null) return leftRank - rightRank;
        if (leftRank != null) return -1;
        if (rightRank != null) return 1;
      }

      return left.displayName.localeCompare(right.displayName);
    });
  }, [agentSort, normalizedAgentSearch, recentAgentRank]);

  async function createNewChat(initialDraft?: string, filesToAttach: PendingAttachment[] = []) {
    if (isCreating) return;
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
    if ((!draft && pendingAttachments.length === 0) || isCreating || isUploadingAttachment) return;

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

  function onSelectAgent(agentId: string) {
    setSelectedAgentId(agentId);
    saveSelectedAgentId(agentId);
  }

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main className={styles.main}>
        <div className={styles.mainContent}>
          <div className={styles.hero}>
            <div className={styles.heroText}>
              <div className={styles.heroTitleRow}>
                <span
                  className={joinClasses(
                    styles.heroIconWrap,
                    styles[`heroIconTone${selectedAgent.tone[0].toUpperCase()}${selectedAgent.tone.slice(1)}`],
                  )}
                >
                  <SelectedAgentIcon size={18} />
                </span>
                <div className={styles.heroTitle}>Hello! I&apos;m {selectedAgent.displayName} agent</div>
              </div>
              <div className={styles.heroHint}>Ask me about {selectedAgent.askHint}</div>
            </div>
          </div>

          <ChatComposer
            className={styles.composer}
            textareaClassName={styles.composerInput}
            placeholder={`Ask ${selectedAgent.displayName}…`}
            value={messageDraft}
            onChange={setMessageDraft}
            onSubmit={submitDraft}
            rows={3}
            disabled={isCreating || isUploadingAttachment}
            attachments={composerAttachments}
            isUploadingAttachment={isUploadingAttachment}
            uploadingAttachmentName={uploadingAttachmentName}
            attachmentError={attachmentError}
            onAddAttachment={addPendingAttachment}
            onRemoveAttachment={removePendingAttachment}
          />

          <section className={styles.agentPicker}>
            <div className={styles.agentPickerTitle}>Recent agents</div>
            {chatsQ.isLoading ? (
              <div className={styles.loadingState} role="status" aria-live="polite">
                <SinasLoader size={26} />
                <span className={styles.loadingText}>Loading recent agents...</span>
              </div>
            ) : recentAgents.length === 0 ? (
              <div className={styles.muted}>No recently used agents yet.</div>
            ) : (
              <div className={styles.recentAgentRow}>
                {recentAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isActive={selectedAgent.id === agent.id}
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
              {allAgents.length === 0 ? (
                <div className={styles.muted}>No agents match your search.</div>
              ) : (
                allAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isActive={selectedAgent.id === agent.id}
                    onSelect={onSelectAgent}
                    className={agentView === "list" ? styles.agentCardList : undefined}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
