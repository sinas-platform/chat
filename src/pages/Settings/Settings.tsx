import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles } from "lucide-react";

import styles from "./Settings.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { Button } from "../../components/Button/Button";

export function SettingsPage() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Sinas - Settings";
  }, []);

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main className={styles.main}>
        <section className={styles.shell}>
          <div className={styles.statusPill}>
            <Sparkles size={14} aria-hidden />
            <span>Coming soon</span>
          </div>

          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>This page is not ready yet.</p>

          <div className={styles.previewCard}>
            <p className={styles.previewText}>Soon you will be able to configure agents here.</p>
          </div>

          <div className={styles.actions}>
            <Button variant="default" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} aria-hidden />
              Go back
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
