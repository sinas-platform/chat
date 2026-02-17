import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { Button } from "../../components/Button/Button";
import { apiClient } from "../../lib/api";
import { getWorkspaceUrl } from "../../lib/workspace";
import type { Chat } from "../../types";
import styles from "./AllChats.module.scss";

export function AllChatsPage() {
  const navigate = useNavigate();
  const ws = getWorkspaceUrl();

  const chatsQ = useQuery({
    queryKey: ["chats", ws],
    queryFn: () => apiClient.listChats(),
  });

  const chats = chatsQ.data ?? [];

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main className={styles.main}>
        <div className={styles.shell}>
          <div className={styles.header}>
            <h1 className={styles.title}>All chats</h1>
          </div>

          <div className={styles.list}>
            {chatsQ.isLoading ? (
              <div className={styles.muted}>Loading…</div>
            ) : chats.length === 0 ? (
              <div className={styles.muted}>No chats yet</div>
            ) : (
              chats.map((chat: Chat) => (
                <Button
                  key={chat.id}
                  variant="minimal"
                  className={styles.chatRow}
                  onClick={() => navigate(`/chats/${chat.id}`)}
                >
                  <span className={styles.chatTitle}>{chat.title ?? "Untitled chat"}</span>
                  <span className={styles.chatTime}>
                    {new Date(chat.updated_at ?? chat.created_at).toLocaleString()}
                  </span>
                </Button>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
