import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";

import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { Button } from "../../components/Button/Button";
import { DropdownMenu } from "../../components/DropdownMenu/DropdownMenu";
import { Input } from "../../components/Input/Input";
import SinasLoader from "../../components/Loader/Loader";
import clockIcon from "../../icons/clock.svg";
import crossIcon from "../../icons/cross.svg";
import pencilIcon from "../../icons/pencil.svg";
import searchIcon from "../../icons/search.svg";
import threeDotsIcon from "../../icons/three-dots.svg";
import TrashIcon from "../../icons/trash.svg?react";
import trashIconSrc from "../../icons/trash.svg";
import { apiClient } from "../../lib/api";
import { buildAgentPlaceholderMetaById } from "../../lib/agentPlaceholders";
import { getApplicationId, getWorkspaceUrl } from "../../lib/workspace";
import type { AgentResponse, Chat } from "../../types";
import styles from "./AllChats.module.scss";

function formatTimeAgo(isoDate: string) {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) return "Unknown time";

  const diffMs = Date.now() - timestamp;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) return "Just now";

  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.floor(diffMs / minuteMs));
    return `${minutes} min ago`;
  }

  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.floor(diffMs / hourMs));
    return `${hours}h ago`;
  }

  const days = Math.max(1, Math.floor(diffMs / dayMs));
  if (days < 7) return `${days}d ago`;

  return new Date(isoDate).toLocaleDateString();
}

function highlightQuery(text: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return text;

  const lowerText = text.toLowerCase();
  const pieces: Array<string | { mark: string }> = [];
  let index = 0;

  while (index < text.length) {
    const matchIndex = lowerText.indexOf(normalizedQuery, index);
    if (matchIndex === -1) {
      pieces.push(text.slice(index));
      break;
    }

    if (matchIndex > index) pieces.push(text.slice(index, matchIndex));
    pieces.push({ mark: text.slice(matchIndex, matchIndex + normalizedQuery.length) });
    index = matchIndex + normalizedQuery.length;
  }

  return pieces.map((piece, i) =>
    typeof piece === "string" ? piece : <mark key={`${piece.mark}-${i}`}>{piece.mark}</mark>,
  );
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

function getAgentFilterValue(chat: Chat): string {
  const namespace = chat.agent_namespace?.trim() ?? "";
  const name = chat.agent_name?.trim() ?? "";
  if (!namespace && !name) return "__unknown__";
  return `${namespace}::${name}`;
}

type SortOptionValue = "most_recent" | "oldest" | "title_asc" | "title_desc";

const SORT_OPTIONS: Array<{ value: SortOptionValue; label: string }> = [
  { value: "most_recent", label: "Most recent" },
  { value: "oldest", label: "Oldest first" },
  { value: "title_asc", label: "Title A-Z" },
  { value: "title_desc", label: "Title Z-A" },
];

export function AllChatsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ws = getWorkspaceUrl();
  const appId = getApplicationId();

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortOptionValue>("most_recent");
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<{
    chatId: string;
    currentTitle: string;
    nextTitle: string;
  } | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    chatIds: string[];
    title?: string;
  } | null>(null);

  useEffect(() => {
    document.title = "Sinas - Chats";
  }, []);

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

  const renameChatM = useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) => apiClient.updateChat(chatId, { title }),
    onSuccess: async (_updatedChat, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["chats", ws] });
      await queryClient.invalidateQueries({ queryKey: ["chat", variables.chatId] });
    },
  });

  const deleteChatsM = useMutation({
    mutationFn: async (chatIds: string[]) => {
      await Promise.all(chatIds.map((chatId) => apiClient.deleteChat(chatId)));
    },
    onSuccess: async (_result, chatIds) => {
      await queryClient.invalidateQueries({ queryKey: ["chats", ws] });
      chatIds.forEach((chatId) => {
        queryClient.removeQueries({ queryKey: ["chat", chatId] });
      });
    },
  });

  const activeAgents = useMemo(() => (agentsQ.data ?? []).filter((agent) => agent.is_active), [agentsQ.data]);
  const agentsById = useMemo(() => new Map(activeAgents.map((agent) => [agent.id, agent] as const)), [activeAgents]);
  const agentsByKey = useMemo(
    () => new Map(activeAgents.map((agent) => [getAgentKey(agent), agent] as const)),
    [activeAgents],
  );
  const placeholderByAgentId = useMemo(() => buildAgentPlaceholderMetaById(activeAgents), [activeAgents]);

  function getChatAgent(chat: Chat): AgentResponse | undefined {
    const byId = chat.agent_id ? agentsById.get(chat.agent_id) : undefined;
    if (byId) return byId;

    const endpointKey = toAgentKey(chat.agent_namespace, chat.agent_name);
    if (!endpointKey) return undefined;
    return agentsByKey.get(endpointKey);
  }

  function getBadgeLabel(chat: Chat): string {
    const agent = getChatAgent(chat);
    if (agent) return agent.name;
    if (chat.agent_name) return chat.agent_name;
    return "Unknown";
  }

  function getBadgeColorStyle(chat: Chat): CSSProperties | undefined {
    const agent = getChatAgent(chat);
    if (!agent) return undefined;
    const placeholder = placeholderByAgentId[agent.id];
    if (!placeholder) return undefined;

    return {
      "--agent-icon-color": placeholder.color,
      "--agent-icon-soft-color": placeholder.softColor,
      "--agent-badge-icon": `url("${placeholder.iconSrc}")`,
    } as CSSProperties;
  }

  const agentFilterOptions = useMemo(() => {
    const map = new Map<string, string>();

    (chatsQ.data ?? []).forEach((chat) => {
      const value = getAgentFilterValue(chat);
      if (map.has(value)) return;

      const byId = chat.agent_id ? agentsById.get(chat.agent_id) : undefined;
      const endpointKey = toAgentKey(chat.agent_namespace, chat.agent_name);
      const byEndpoint = endpointKey ? agentsByKey.get(endpointKey) : undefined;
      const label = byId?.name ?? byEndpoint?.name ?? chat.agent_name ?? "Unknown";
      map.set(value, label);
    });

    const options = Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [{ value: "all", label: "All" }, ...options];
  }, [agentsById, agentsByKey, chatsQ.data]);

  const effectiveCategoryFilter =
    categoryFilter === "all" || agentFilterOptions.some((option) => option.value === categoryFilter)
      ? categoryFilter
      : "all";

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredChats = useMemo(() => {
    const chats = chatsQ.data ?? [];

    return chats
      .filter((chat) => {
        const matchesQuery =
          !normalizedSearchQuery || (chat.title ?? "").toLowerCase().includes(normalizedSearchQuery);
        if (!matchesQuery) return false;

        if (effectiveCategoryFilter === "all") return true;
        return getAgentFilterValue(chat) === effectiveCategoryFilter;
      })
      .sort((a, b) => {
        if (sortBy === "title_asc") {
          return (a.title ?? "Untitled chat").localeCompare(b.title ?? "Untitled chat");
        }

        if (sortBy === "title_desc") {
          return (b.title ?? "Untitled chat").localeCompare(a.title ?? "Untitled chat");
        }

        const leftTimestamp = new Date(a.updated_at ?? a.created_at).getTime();
        const rightTimestamp = new Date(b.updated_at ?? b.created_at).getTime();
        if (sortBy === "oldest") return leftTimestamp - rightTimestamp;
        return rightTimestamp - leftTimestamp;
      });
  }, [chatsQ.data, effectiveCategoryFilter, normalizedSearchQuery, sortBy]);

  const selectedCategoryLabel =
    agentFilterOptions.find((option) => option.value === effectiveCategoryFilter)?.label ?? "All";
  const selectedSortLabel = SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? "Most recent";

  function onStartRename(chat: Chat) {
    if (isSelectMode) return;
    const currentTitle = chat.title?.trim() || "Untitled chat";
    setRenameDialog({
      chatId: chat.id,
      currentTitle,
      nextTitle: currentTitle,
    });
    setDeleteDialog(null);
  }

  function onStartDelete(chat: Chat) {
    if (isSelectMode) return;
    const title = chat.title?.trim() || "Untitled chat";
    setDeleteDialog({ chatIds: [chat.id], title });
    setRenameDialog(null);
  }

  function toggleSelectMode() {
    if (isSelectMode) {
      setIsSelectMode(false);
      setSelectedChatIds(new Set());
      return;
    }

    setIsSelectMode(true);
    setRenameDialog(null);
    setDeleteDialog(null);
  }

  function toggleChatSelection(chatId: string) {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  function onStartBulkDelete() {
    const chatIds = Array.from(selectedChatIds);
    if (chatIds.length === 0) return;
    setDeleteDialog({ chatIds });
    setRenameDialog(null);
  }

  function toggleSelectAllVisible() {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      const allVisibleSelected =
        filteredChats.length > 0 && filteredChats.every((chat) => next.has(chat.id));

      if (allVisibleSelected) {
        filteredChats.forEach((chat) => next.delete(chat.id));
      } else {
        filteredChats.forEach((chat) => next.add(chat.id));
      }

      return next;
    });
  }

  async function onConfirmRenameChat() {
    if (!renameDialog) return;
    const title = renameDialog.nextTitle.trim();
    if (!title || title === renameDialog.currentTitle) return;

    try {
      setActionError(null);
      await renameChatM.mutateAsync({ chatId: renameDialog.chatId, title });
      setRenameDialog(null);
    } catch {
      setActionError("Could not change chat title.");
    }
  }

  async function onConfirmDeleteChat() {
    if (!deleteDialog) return;
    try {
      setActionError(null);
      await deleteChatsM.mutateAsync(deleteDialog.chatIds);
      if (isSelectMode) {
        setIsSelectMode(false);
        setSelectedChatIds(new Set());
      }
      setDeleteDialog(null);
    } catch {
      setActionError("Could not delete chat.");
    }
  }

  useEffect(() => {
    if (!renameDialog && !deleteDialog) return;

    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (renameChatM.isPending || deleteChatsM.isPending) return;
      setRenameDialog(null);
      setDeleteDialog(null);
    }

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [deleteDialog, deleteChatsM.isPending, renameChatM.isPending, renameDialog]);

  const trimmedRenameTitle = renameDialog?.nextTitle.trim() ?? "";
  const canSaveRename =
    Boolean(renameDialog) &&
    trimmedRenameTitle.length > 0 &&
    trimmedRenameTitle !== renameDialog?.currentTitle &&
    !renameChatM.isPending &&
    !deleteChatsM.isPending;
  const canDelete = Boolean(deleteDialog) && !renameChatM.isPending && !deleteChatsM.isPending;
  const selectedCount = selectedChatIds.size;
  const visibleSelectedCount = filteredChats.reduce(
    (count, chat) => count + (selectedChatIds.has(chat.id) ? 1 : 0),
    0,
  );
  const hasVisibleChats = filteredChats.length > 0;
  const allVisibleSelected = hasVisibleChats && visibleSelectedCount === filteredChats.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const selectAllDisabled = !hasVisibleChats || renameChatM.isPending || deleteChatsM.isPending;

  useEffect(() => {
    if (!selectAllCheckboxRef.current) return;
    selectAllCheckboxRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main className={styles.main}>
        <div className={styles.shell}>
          <div className={styles.searchRow}>
            <Input
              wrapperClassName={styles.searchField}
              startAction={<img className={styles.searchIcon} src={searchIcon} alt="" aria-hidden />}
              startActionClassName={styles.searchStartAction}
              className={styles.searchInput}
              type="search"
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <div className={styles.controlsRow}>
              <div className={joinClasses(styles.selectActions, isSelectMode && styles.selectActionsSelectMode)}>
                {isSelectMode ? (
                  <>
                    <label
                      className={joinClasses(
                        styles.selectAllToggle,
                        selectAllDisabled && styles.selectAllToggleDisabled,
                      )}
                    >
                      <span className={styles.selectCheckbox}>
                        <input
                          ref={selectAllCheckboxRef}
                          type="checkbox"
                          className={styles.selectCheckboxInput}
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          disabled={selectAllDisabled}
                          aria-label="Select all visible chats"
                          aria-checked={someVisibleSelected ? "mixed" : allVisibleSelected}
                        />
                        <span className={styles.selectCheckboxControl} aria-hidden />
                      </span>
                    </label>
                    <span className={styles.selectCount}>{selectedCount} selected</span>
                    <span className={styles.selectIconActions}>
                      {selectedCount > 0 ? (
                        <Button
                          variant="minimal"
                          className={styles.selectIconAction}
                          onClick={onStartBulkDelete}
                          disabled={renameChatM.isPending || deleteChatsM.isPending}
                          aria-label="Delete selected chats"
                        >
                          <img className={styles.selectActionIcon} src={trashIconSrc} alt="" aria-hidden />
                        </Button>
                      ) : null}
                      <Button
                        variant="minimal"
                        className={styles.selectIconAction}
                        onClick={toggleSelectMode}
                        disabled={renameChatM.isPending || deleteChatsM.isPending}
                        aria-label="Exit selection mode"
                      >
                        <X size={20} aria-hidden />
                      </Button>
                    </span>
                  </>
                ) : (
                  <Button
                    className={styles.selectActionButton}
                    onClick={toggleSelectMode}
                    disabled={renameChatM.isPending || deleteChatsM.isPending}
                    variant="default"
                  >
                    Select
                  </Button>
                )}
              </div>

              <div className={styles.filterActions}>
                <DropdownMenu
                  trigger={
                    <>
                      <span className={styles.filterLabel}>Category: {selectedCategoryLabel}</span>
                      <ChevronDown size={14} />
                    </>
                  }
                  triggerAriaLabel="Filter chats by category"
                  variant="text"
                  triggerClassName={styles.filterTrigger}
                  menuClassName={styles.filterMenu}
                  items={agentFilterOptions.map((option) => ({
                    id: `category-${option.value}`,
                    label: option.label,
                    onSelect: () => setCategoryFilter(option.value),
                  }))}
                />

                <DropdownMenu
                  trigger={
                    <>
                      <span className={styles.filterLabel}>{selectedSortLabel}</span>
                      <ChevronDown size={14} />
                    </>
                  }
                  triggerAriaLabel="Sort chats"
                  variant="text"
                  triggerClassName={styles.filterTrigger}
                  menuClassName={styles.filterMenu}
                  items={SORT_OPTIONS.map((option) => ({
                    id: `sort-${option.value}`,
                    label: option.label,
                    onSelect: () => setSortBy(option.value),
                  }))}
                />
              </div>
            </div>
          </div>

          <div className={styles.list}>
            {actionError ? <div className={styles.error}>{actionError}</div> : null}

            {chatsQ.isLoading ? (
              <div className={styles.loadingState} role="status" aria-live="polite">
                <SinasLoader size={26} />
                <span className={styles.loadingText}>Loading chats...</span>
              </div>
            ) : filteredChats.length === 0 ? (
              <div className={styles.muted}>No chats yet</div>
            ) : (
              filteredChats.map((chat: Chat) => (
                <div key={chat.id} className={styles.chatRow}>
                  {isSelectMode ? (
                    <div className={styles.selectCell}>
                      <label className={styles.selectCheckbox}>
                        <input
                          type="checkbox"
                          className={styles.selectCheckboxInput}
                          checked={selectedChatIds.has(chat.id)}
                          onChange={() => toggleChatSelection(chat.id)}
                          aria-label={`Select ${chat.title ?? "Untitled chat"}`}
                        />
                        <span className={styles.selectCheckboxControl} aria-hidden />
                      </label>
                    </div>
                  ) : null}

                  <Button
                    variant="minimal"
                    className={styles.chatMain}
                    onClick={() => {
                      if (isSelectMode) {
                        toggleChatSelection(chat.id);
                        return;
                      }
                      navigate(`/chats/${chat.id}`);
                    }}
                  >
                    <span className={styles.chatTitle}>
                      {highlightQuery(chat.title ?? "Untitled chat", searchQuery)}
                    </span>
                  </Button>

                  <div className={styles.chatMeta}>
                    <span className={styles.agentBadge} style={getBadgeColorStyle(chat)}>
                      {getBadgeLabel(chat)}
                    </span>

                    <span className={styles.chatTime}>
                      <img className={styles.chatTimeIcon} src={clockIcon} alt="" aria-hidden />
                      {formatTimeAgo(chat.updated_at ?? chat.created_at)}
                    </span>

                    {!isSelectMode ? (
                      <DropdownMenu
                        trigger={<img className={styles.rowMenuIcon} src={threeDotsIcon} alt="" aria-hidden />}
                        triggerAriaLabel="Open chat actions"
                        variant="icon"
                        triggerClassName={styles.rowMenuTrigger}
                        menuClassName={styles.rowMenu}
                        items={[
                          {
                            id: "rename",
                            label: (
                              <span className={styles.actionMenuLabel}>
                                <img className={styles.actionMenuIcon} src={pencilIcon} alt="" aria-hidden />
                                <span>Change title</span>
                              </span>
                            ),
                            onSelect: () => onStartRename(chat),
                            disabled: renameChatM.isPending || deleteChatsM.isPending,
                          },
                          {
                            id: "delete",
                            label: (
                              <span className={styles.actionMenuLabel}>
                                <img className={styles.actionMenuIcon} src={trashIconSrc} alt="" aria-hidden />
                                <span>Delete</span>
                              </span>
                            ),
                            onSelect: () => onStartDelete(chat),
                            disabled: renameChatM.isPending || deleteChatsM.isPending,
                          },
                        ]}
                      />
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {renameDialog ? (
        <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Change chat title">
          <div
            className={styles.renameModalBackdrop}
            onClick={() => {
              if (!renameChatM.isPending && !deleteChatsM.isPending) setRenameDialog(null);
            }}
          />
          <div className={styles.renameModalPanel}>
            <div className={styles.renameModalHeader}>
              <div>
                <div className={styles.renameModalTitle}>Change chat title</div>
                <div className={styles.renameModalSubTitle}>Choose a new name for this chat.</div>
              </div>
              <Button
                variant="minimal"
                className={styles.renameModalCloseButton}
                onClick={() => setRenameDialog(null)}
                disabled={renameChatM.isPending || deleteChatsM.isPending}
                aria-label="Close"
              >
                <img src={crossIcon} width={24} height={24} alt="" aria-hidden />
              </Button>
            </div>

            <label className={styles.renameModalField}>
              <span className={styles.renameModalLabel}>Title</span>
              <Input
                value={renameDialog.nextTitle}
                onChange={(e) =>
                  setRenameDialog((prev) => (prev ? { ...prev, nextTitle: e.target.value } : prev))
                }
                maxLength={120}
                autoFocus
                endActionClassName={styles.renameModalInputActionWrapper}
                endAction={
                  <Button
                    variant="minimal"
                    className={styles.renameModalInputAction}
                    onClick={onConfirmRenameChat}
                    disabled={!canSaveRename}
                  >
                    <span className={styles.renameModalInputActionContent}>Save</span>
                  </Button>
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSaveRename) onConfirmRenameChat();
                }}
              />
            </label>
          </div>
        </div>
      ) : null}

      {deleteDialog ? (
        <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Delete chat">
          <div
            className={styles.modalBackdrop}
            onClick={() => {
              if (!renameChatM.isPending && !deleteChatsM.isPending) setDeleteDialog(null);
            }}
          />
          <div className={styles.modalPanel}>
            <div className={styles.modalTitle}>
              {deleteDialog.chatIds.length > 1 ? `Delete ${deleteDialog.chatIds.length} chats?` : "Delete chat?"}
            </div>
            <div className={styles.modalSubTitle}>
              {deleteDialog.chatIds.length > 1
                ? "This will permanently remove the selected chats and cannot be undone."
                : `This will permanently remove "${deleteDialog.title ?? "Untitled chat"}" and cannot be undone.`}
            </div>
            <div className={styles.modalActions}>
              <Button
                onClick={() => setDeleteDialog(null)}
                disabled={renameChatM.isPending || deleteChatsM.isPending}
              >
                Cancel
              </Button>
              <Button
                className={styles.dangerButton}
                onClick={onConfirmDeleteChat}
                disabled={!canDelete}
              >
                Delete <TrashIcon className={styles.dangerButtonIcon} aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
