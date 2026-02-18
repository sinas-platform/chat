import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clock3, MoreHorizontal, Search } from "lucide-react";

import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { Button } from "../../components/Button/Button";
import { DropdownMenu } from "../../components/DropdownMenu/DropdownMenu";
import { Input } from "../../components/Input/Input";
import { apiClient } from "../../lib/api";
import { getAgentByNamespaceAndName } from "../../lib/agents";
import { getWorkspaceUrl } from "../../lib/workspace";
import type { Chat } from "../../types";
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

function getBadgeToneClass(chat: Chat): string {
  const agent = getAgentByNamespaceAndName(chat.agent_namespace, chat.agent_name);
  if (!agent) return styles.agentBadgeToneNeutral;
  if (agent.tone === "yellow") return styles.agentBadgeToneYellow;
  if (agent.tone === "blue") return styles.agentBadgeToneBlue;
  if (agent.tone === "mint") return styles.agentBadgeToneMint;
  return styles.agentBadgeToneNeutral;
}

function getBadgeLabel(chat: Chat): string {
  const agent = getAgentByNamespaceAndName(chat.agent_namespace, chat.agent_name);
  if (agent) return agent.displayName;
  if (chat.agent_name) return chat.agent_name;
  return "Unknown";
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
  const [deleteDialog, setDeleteDialog] = useState<{
    chatIds: string[];
    title?: string;
  } | null>(null);

  const chatsQ = useQuery({
    queryKey: ["chats", ws],
    queryFn: () => apiClient.listChats(),
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

  const agentFilterOptions = useMemo(() => {
    const map = new Map<string, string>();

    (chatsQ.data ?? []).forEach((chat) => {
      const value = getAgentFilterValue(chat);
      if (!map.has(value)) map.set(value, getBadgeLabel(chat));
    });

    const options = Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [{ value: "all", label: "All" }, ...options];
  }, [chatsQ.data]);

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

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main className={styles.main}>
        <div className={styles.shell}>
          <div className={styles.searchRow}>
            <div className={styles.searchField}>
              <Search size={16} />
              <input
                className={styles.searchInput}
                placeholder="Search keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className={styles.controlsRow}>
              <div className={styles.selectActions}>
                {isSelectMode ? (
                  <>
                    <span className={styles.selectCount}>{selectedCount} selected</span>
                    <Button
                      className={styles.selectActionButton}
                      onClick={toggleSelectMode}
                      disabled={renameChatM.isPending || deleteChatsM.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      className={joinClasses(styles.selectActionButton, styles.dangerButton)}
                      onClick={onStartBulkDelete}
                      disabled={!selectedCount || renameChatM.isPending || deleteChatsM.isPending}
                    >
                      Delete
                    </Button>
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
              <div className={styles.muted}>Loading…</div>
            ) : filteredChats.length === 0 ? (
              <div className={styles.muted}>No chats yet</div>
            ) : (
              filteredChats.map((chat: Chat) => (
                <div key={chat.id} className={styles.chatRow}>
                  {isSelectMode ? (
                    <div className={styles.selectCell}>
                      <input
                        type="checkbox"
                        className={styles.selectCheckbox}
                        checked={selectedChatIds.has(chat.id)}
                        onChange={() => toggleChatSelection(chat.id)}
                        aria-label={`Select ${chat.title ?? "Untitled chat"}`}
                      />
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
                    <div className={styles.chatMetaTop}>
                      <span className={joinClasses(styles.agentBadge, getBadgeToneClass(chat))}>
                        {getBadgeLabel(chat)}
                      </span>

                      {!isSelectMode ? (
                        <DropdownMenu
                          trigger={<MoreHorizontal size={16} />}
                          triggerAriaLabel="Open chat actions"
                          variant="icon"
                          items={[
                            {
                              id: "rename",
                              label: "Change title",
                              onSelect: () => onStartRename(chat),
                              disabled: renameChatM.isPending || deleteChatsM.isPending,
                            },
                            {
                              id: "delete",
                              label: "Delete",
                              onSelect: () => onStartDelete(chat),
                              danger: true,
                              disabled: renameChatM.isPending || deleteChatsM.isPending,
                            },
                          ]}
                        />
                      ) : null}
                    </div>

                    <span className={styles.chatTime}>
                      <Clock3 size={14} />
                      {formatTimeAgo(chat.updated_at ?? chat.created_at)}
                    </span>
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
            className={styles.modalBackdrop}
            onClick={() => {
              if (!renameChatM.isPending && !deleteChatsM.isPending) setRenameDialog(null);
            }}
          />
          <div className={styles.modalPanel}>
            <div className={styles.modalTitle}>Change chat title</div>
            <div className={styles.modalSubTitle}>Choose a new name for this chat.</div>
            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Title</span>
              <Input
                value={renameDialog.nextTitle}
                onChange={(e) =>
                  setRenameDialog((prev) => (prev ? { ...prev, nextTitle: e.target.value } : prev))
                }
                maxLength={120}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSaveRename) onConfirmRenameChat();
                }}
              />
            </label>
            <div className={styles.modalActions}>
              <Button
                onClick={() => setRenameDialog(null)}
                disabled={renameChatM.isPending || deleteChatsM.isPending}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={onConfirmRenameChat} disabled={!canSaveRename}>
                Save
              </Button>
            </div>
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
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
