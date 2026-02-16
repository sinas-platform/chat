import styles from "./Chat.module.scss";

export function ChatPage() {
  return (
    <div className={styles.chatPage}>
      <div className={styles.chatShell}>
        <h1>Chat</h1>
        <p>Sidebar + messages UI comes next.</p>
      </div>
    </div>
  );
}
