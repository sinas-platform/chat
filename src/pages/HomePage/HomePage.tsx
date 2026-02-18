import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, LayoutGrid, Lightbulb, List, Mic, MicOff, Newspaper, type LucideIcon } from "lucide-react";

import styles from "./HomePage.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { DropdownMenu } from "../../components/DropdownMenu/DropdownMenu";
import { apiClient } from "../../lib/api";
import {
  AGENT_OPTIONS,
  getAgentById,
  getDefaultAgent,
  getSelectedAgent,
  saveSelectedAgentId,
  type AgentOption,
} from "../../lib/agents";
import { useSpeechToText } from "../../lib/useSpeechToText";
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
  const [isCreating, setIsCreating] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentSort, setAgentSort] = useState<AgentSortMode>("alphabetical");
  const [agentView, setAgentView] = useState<AgentViewMode>("grid");
  const {
    isSupported: isSpeechSupported,
    isListening,
    startListening,
    stopListening,
  } = useSpeechToText({
    onTranscript: (spokenText) => {
      setMessageDraft((prev) => {
        if (!prev.trim()) return spokenText;
        return /\s$/.test(prev) ? `${prev}${spokenText}` : `${prev} ${spokenText}`;
      });
    },
  });

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

  async function createNewChat(initialDraft?: string) {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const draft = (initialDraft ?? "").trim();

      const chat = await apiClient.createChatWithAgent(selectedAgent.namespace, selectedAgent.name, {
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

          <form className={styles.composer} onSubmit={onSubmit}>
            <textarea
              className={styles.composerInput}
              placeholder={`Ask ${selectedAgent.displayName}…`}
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={3}
              disabled={isCreating}
            />
            <button
              type="button"
              className={joinClasses(styles.micButton, isListening && styles.micButtonActive)}
              onClick={isListening ? stopListening : startListening}
              disabled={!isSpeechSupported || isCreating}
              aria-label={isListening ? "Stop voice input" : "Start voice input"}
              aria-pressed={isListening}
              title={isSpeechSupported ? "Voice input" : "Voice input is not supported in this browser"}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          </form>

          <section className={styles.agentPicker}>
            <div className={styles.agentPickerTitle}>Recent agents</div>
            {chatsQ.isLoading ? (
              <div className={styles.muted}>Loading recent agents…</div>
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
              <input
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
