import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, MoreHorizontal, Search } from "lucide-react";

import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { Button } from "../../components/Button/Button";
import { DropdownMenu } from "../../components/DropdownMenu/DropdownMenu";
import { Input } from "../../components/Input/Input";
import { apiClient } from "../../lib/api";
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

export function AllChatsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ws = getWorkspaceUrl();

  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<{
    chatId: string;
    currentTitle: string;
    nextTitle: string;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    chatId: string;
    title: string;
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

  const deleteChatM = useMutation({
    mutationFn: (chatId: string) => apiClient.deleteChat(chatId),
    onSuccess: async (_result, chatId) => {
      await queryClient.invalidateQueries({ queryKey: ["chats", ws] });
      queryClient.removeQueries({ queryKey: ["chat", chatId] });
    },
  });

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredChats = useMemo(() => {
    const chats = chatsQ.data ?? [];
    return chats
      .filter((chat) => {
        if (!normalizedSearchQuery) return true;
        return (chat.title ?? "").toLowerCase().includes(normalizedSearchQuery);
      })
      .sort((a, b) => {
        const leftDate = new Date(a.updated_at ?? a.created_at).getTime();
        const rightDate = new Date(b.updated_at ?? b.created_at).getTime();
        return rightDate - leftDate;
      });
  }, [chatsQ.data, normalizedSearchQuery]);

  function onStartRename(chat: Chat) {
    const currentTitle = chat.title?.trim() || "Untitled chat";
    setRenameDialog({
      chatId: chat.id,
      currentTitle,
      nextTitle: currentTitle,
    });
    setDeleteDialog(null);
  }

  function onStartDelete(chat: Chat) {
    const title = chat.title?.trim() || "Untitled chat";
    setDeleteDialog({ chatId: chat.id, title });
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
      await deleteChatM.mutateAsync(deleteDialog.chatId);
      setDeleteDialog(null);
    } catch {
      setActionError("Could not delete chat.");
    }
  }

  useEffect(() => {
    if (!renameDialog && !deleteDialog) return;

    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (renameChatM.isPending || deleteChatM.isPending) return;
      setRenameDialog(null);
      setDeleteDialog(null);
    }

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [deleteDialog, deleteChatM.isPending, renameChatM.isPending, renameDialog]);

  const trimmedRenameTitle = renameDialog?.nextTitle.trim() ?? "";
  const canSaveRename =
    Boolean(renameDialog) &&
    trimmedRenameTitle.length > 0 &&
    trimmedRenameTitle !== renameDialog?.currentTitle &&
    !renameChatM.isPending &&
    !deleteChatM.isPending;
  const canDelete = Boolean(deleteDialog) && !renameChatM.isPending && !deleteChatM.isPending;

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main className={styles.main}>
        <div className={styles.shell}>
          <div className={styles.header}>
            <h1 className={styles.title}>All chats</h1>
          </div>

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
                  <Button
                    variant="minimal"
                    className={styles.chatMain}
                    onClick={() => navigate(`/chats/${chat.id}`)}
                  >
                    <span className={styles.chatTitle}>
                      {highlightQuery(chat.title ?? "Untitled chat", searchQuery)}
                    </span>
                  </Button>

                  <div className={styles.chatMeta}>
                    <span className={styles.chatTime}>
                      <Clock3 size={14} />
                      {formatTimeAgo(chat.updated_at ?? chat.created_at)}
                    </span>

                    <DropdownMenu
                      trigger={<MoreHorizontal size={16} />}
                      triggerAriaLabel="Open chat actions"
                      variant="icon"
                      items={[
                        {
                          id: "rename",
                          label: "Change title",
                          onSelect: () => onStartRename(chat),
                          disabled: renameChatM.isPending || deleteChatM.isPending,
                        },
                        {
                          id: "delete",
                          label: "Delete",
                          onSelect: () => onStartDelete(chat),
                          danger: true,
                          disabled: renameChatM.isPending || deleteChatM.isPending,
                        },
                      ]}
                    />
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
              if (!renameChatM.isPending && !deleteChatM.isPending) setRenameDialog(null);
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
                disabled={renameChatM.isPending || deleteChatM.isPending}
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
              if (!renameChatM.isPending && !deleteChatM.isPending) setDeleteDialog(null);
            }}
          />
          <div className={styles.modalPanel}>
            <div className={styles.modalTitle}>Delete chat?</div>
            <div className={styles.modalSubTitle}>
              This will permanently remove "{deleteDialog.title}" and cannot be undone.
            </div>
            <div className={styles.modalActions}>
              <Button
                onClick={() => setDeleteDialog(null)}
                disabled={renameChatM.isPending || deleteChatM.isPending}
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
