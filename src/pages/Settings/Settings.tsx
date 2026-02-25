import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Settings2 } from "lucide-react";

import styles from "./Settings.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { Button } from "../../components/Button/Button";
import {
  DEFAULT_VISIBLE_AGENTS_PREFERENCE,
  getAgentRef,
  normalizeVisibleAgentsPreferenceValue,
  useVisibleAgentsPreference,
  type VisibleAgentsPreferenceValue,
} from "../../hooks/useVisibleAgentsPreference";
import { getWorkspaceUrl } from "../../lib/workspace";

function sortAgentsForSettings<T extends { namespace: string; name: string }>(agents: T[]): T[] {
  return [...agents].sort((left, right) => {
    const leftLabel = `${left.namespace} / ${left.name}`;
    const rightLabel = `${right.namespace} / ${right.name}`;
    return leftLabel.localeCompare(rightLabel);
  });
}

function preferenceEquals(left: VisibleAgentsPreferenceValue, right: VisibleAgentsPreferenceValue): boolean {
  const normalizedLeft = normalizeVisibleAgentsPreferenceValue(left);
  const normalizedRight = normalizeVisibleAgentsPreferenceValue(right);

  if (normalizedLeft.mode !== normalizedRight.mode) return false;
  if (normalizedLeft.visibleAgentRefs.length !== normalizedRight.visibleAgentRefs.length) return false;

  return normalizedLeft.visibleAgentRefs.every((ref, index) => ref === normalizedRight.visibleAgentRefs[index]);
}

export function SettingsPage() {
  const navigate = useNavigate();
  const workspaceUrl = getWorkspaceUrl();
  const hasWorkspaceUrl = workspaceUrl.length > 0;
  const visibleAgentsPreference = useVisibleAgentsPreference();
  const { agentsQuery, statesQuery } = visibleAgentsPreference;

  const sortedAgents = useMemo(
    () => sortAgentsForSettings(visibleAgentsPreference.activeAgents),
    [visibleAgentsPreference.activeAgents],
  );
  const allAgentRefs = useMemo(() => sortedAgents.map((agent) => getAgentRef(agent)), [sortedAgents]);

  const [draftPreference, setDraftPreference] = useState<VisibleAgentsPreferenceValue>(DEFAULT_VISIBLE_AGENTS_PREFERENCE);
  const [isDirty, setIsDirty] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Sinas - Settings";
  }, []);

  useEffect(() => {
    if (isDirty) return;
    setDraftPreference(visibleAgentsPreference.preference);
  }, [isDirty, visibleAgentsPreference.preference]);

  const effectiveVisibleRefs = useMemo(() => {
    if (draftPreference.mode === "all") return allAgentRefs;

    const refSet = new Set(allAgentRefs);
    return draftPreference.visibleAgentRefs.filter((ref) => refSet.has(ref));
  }, [allAgentRefs, draftPreference]);

  const effectiveVisibleRefSet = useMemo(() => new Set(effectiveVisibleRefs), [effectiveVisibleRefs]);
  const selectedCount = effectiveVisibleRefs.length;
  const totalAgentCount = sortedAgents.length;
  const hasUnsavedChanges = isDirty && !preferenceEquals(draftPreference, visibleAgentsPreference.preference);
  const saveDisabled =
    !hasWorkspaceUrl ||
    agentsQuery.isLoading ||
    agentsQuery.isError ||
    statesQuery.isLoading ||
    statesQuery.isError ||
    visibleAgentsPreference.isSavingPreference ||
    !hasUnsavedChanges;

  function updateDraft(next: VisibleAgentsPreferenceValue) {
    visibleAgentsPreference.resetSavePreferenceError();
    setSaveMessage(null);
    setIsDirty(true);
    setDraftPreference(normalizeVisibleAgentsPreferenceValue(next));
  }

  function setCustomVisibleRefs(nextRefs: string[]) {
    updateDraft({
      version: 1,
      mode: "custom",
      visibleAgentRefs: allAgentRefs.filter((ref) => nextRefs.includes(ref)),
    });
  }

  function toggleAgent(ref: string) {
    const currentSet = new Set(effectiveVisibleRefs);
    if (currentSet.has(ref)) currentSet.delete(ref);
    else currentSet.add(ref);

    setCustomVisibleRefs(Array.from(currentSet));
  }

  function selectAllAgents() {
    setCustomVisibleRefs(allAgentRefs);
  }

  function selectNoAgents() {
    updateDraft({
      version: 1,
      mode: "custom",
      visibleAgentRefs: [],
    });
  }

  function resetToDefault() {
    updateDraft(DEFAULT_VISIBLE_AGENTS_PREFERENCE);
  }

  async function save() {
    if (saveDisabled) return;

    try {
      await visibleAgentsPreference.savePreference(draftPreference);
      setIsDirty(false);
      setSaveMessage("Saved homepage agent visibility preferences.");
    } catch {
      setSaveMessage(null);
    }
  }

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main className={styles.main}>
        <section className={styles.shell}>
          <div className={styles.headerRow}>
            <div>
              <h1 className={styles.title}>Settings</h1>
              <p className={styles.subtitle}>Manage what appears on your homepage.</p>
            </div>

            <Button variant="default" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} aria-hidden />
              Go back
            </Button>
          </div>

          <section className={styles.card} aria-labelledby="homepage-agents-title">
            <div className={styles.cardHeader}>
              <div className={styles.cardTitleRow}>
                <span className={styles.cardIcon} aria-hidden>
                  <Settings2 size={16} />
                </span>
                <h2 id="homepage-agents-title" className={styles.cardTitle}>
                  Homepage Agents
                </h2>
              </div>
              <p className={styles.cardDescription}>
                Choose which active agents are shown on the homepage. This preference is saved privately to your Sinas
                state.
              </p>
            </div>

            {!hasWorkspaceUrl ? (
              <div className={styles.errorBox} role="alert">
                <span>Workspace URL is not configured. Select a workspace before editing preferences.</span>
              </div>
            ) : null}

            {visibleAgentsPreference.preferenceReadErrorMessage ? (
              <div className={styles.errorBox} role="alert">
                <span>{visibleAgentsPreference.preferenceReadErrorMessage}</span>
                {visibleAgentsPreference.preferenceReadErrorMessage ===
                "Missing permissions to read/write preferences state" ? null : (
                  <Button
                    variant="minimal"
                    className={styles.inlineAction}
                    onClick={() => void statesQuery.refetch()}
                    disabled={statesQuery.isFetching}
                  >
                    Retry
                  </Button>
                )}
              </div>
            ) : null}

            {visibleAgentsPreference.preferenceWriteErrorMessage ? (
              <div className={styles.errorBox} role="alert">
                <span>{visibleAgentsPreference.preferenceWriteErrorMessage}</span>
              </div>
            ) : null}

            {saveMessage ? (
              <div className={styles.successBox} role="status" aria-live="polite">
                <span>{saveMessage}</span>
              </div>
            ) : null}

            <div className={styles.summaryRow}>
              <div className={styles.summaryPill}>
                {draftPreference.mode === "all" ? "Default: show all agents" : `Custom: ${selectedCount} selected`}
              </div>
              <div className={styles.summaryText}>
                {totalAgentCount} active agent{totalAgentCount === 1 ? "" : "s"} available
              </div>
            </div>

            <div className={styles.toolbar}>
              <div className={styles.actionGroup}>
                <Button
                  variant="default"
                  onClick={selectAllAgents}
                  disabled={totalAgentCount === 0 || agentsQuery.isLoading || statesQuery.isLoading}
                >
                  Select all
                </Button>
                <Button
                  variant="default"
                  onClick={selectNoAgents}
                  disabled={totalAgentCount === 0 || agentsQuery.isLoading || statesQuery.isLoading}
                >
                  Select none
                </Button>
                <Button
                  variant="default"
                  onClick={resetToDefault}
                  disabled={agentsQuery.isLoading || statesQuery.isLoading}
                >
                  Reset to default (show all)
                </Button>
              </div>
            </div>

            <div className={styles.listShell}>
              {agentsQuery.isLoading ? (
                <div className={styles.emptyState}>Loading agents...</div>
              ) : agentsQuery.isError ? (
                <div className={styles.errorBox} role="alert">
                  <span>Could not load agents. Please try again.</span>
                  <Button
                    variant="minimal"
                    className={styles.inlineAction}
                    onClick={() => void agentsQuery.refetch()}
                    disabled={agentsQuery.isFetching}
                  >
                    Retry
                  </Button>
                </div>
              ) : sortedAgents.length === 0 ? (
                <div className={styles.emptyState}>No active agents available.</div>
              ) : (
                <ul className={styles.agentList}>
                  {sortedAgents.map((agent) => {
                    const agentRef = getAgentRef(agent);
                    const checked = draftPreference.mode === "all" || effectiveVisibleRefSet.has(agentRef);
                    const description = agent.description?.trim() || "No description available.";

                    return (
                      <li key={agent.id} className={styles.agentRow}>
                        <label className={styles.agentLabel}>
                          <input
                            className={styles.checkbox}
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAgent(agentRef)}
                            disabled={visibleAgentsPreference.isSavingPreference}
                          />
                          <span className={styles.agentMeta}>
                            <span className={styles.agentName}>
                              {agent.namespace} / {agent.name}
                            </span>
                            <span className={styles.agentRef}>{agentRef}</span>
                            <span className={styles.agentDescription}>{description}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className={styles.footerActions}>
              <div className={styles.footerHint}>
                {hasUnsavedChanges ? "You have unsaved changes." : "Changes are saved."}
              </div>
              <Button variant="primary" onClick={() => void save()} disabled={saveDisabled}>
                {visibleAgentsPreference.isSavingPreference ? "Saving..." : "Save"}
              </Button>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}

