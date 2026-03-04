import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Bot, Settings2 } from "lucide-react";

import styles from "./Settings.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { Button } from "../../components/Button/Button";
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import {
  DEFAULT_VISIBLE_AGENTS_PREFERENCE,
  getAgentRef,
  normalizeVisibleAgentsPreferenceValue,
  useVisibleAgentsPreference,
  type VisibleAgentsPreferenceValue,
} from "../../hooks/useVisibleAgentsPreference";
import { apiClient } from "../../lib/api";
import { buildAgentPlaceholderMetaById, type AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import { getWorkspaceUrl } from "../../lib/workspace";
import type { AgentResponse } from "../../types";

const AGENT_TONES = ["yellow", "blue", "mint"] as const;

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

function getAgentTone(agent: Pick<AgentResponse, "id" | "namespace" | "name">): (typeof AGENT_TONES)[number] {
  const source = `${agent.id}:${agent.namespace}:${agent.name}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return AGENT_TONES[hash % AGENT_TONES.length] ?? "yellow";
}

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

function getPlaceholderCssVars(placeholder: AgentPlaceholderMeta | undefined): CSSProperties | undefined {
  if (!placeholder) return undefined;

  return {
    "--agent-icon-color": placeholder.color,
    "--agent-icon-soft-color": placeholder.softColor,
  } as CSSProperties;
}

function getPlaceholderGlyphStyle(placeholder: AgentPlaceholderMeta | undefined): CSSProperties | undefined {
  if (!placeholder) return undefined;

  const iconUrl = `url("${placeholder.iconSrc}")`;
  return {
    WebkitMaskImage: iconUrl,
    maskImage: iconUrl,
  } as CSSProperties;
}

export function SettingsPage() {
  const workspaceUrl = getWorkspaceUrl();
  const hasWorkspaceUrl = workspaceUrl.length > 0;
  const visibleAgentsPreference = useVisibleAgentsPreference();
  const { agentsQuery, statesQuery } = visibleAgentsPreference;

  const sortedAgents = useMemo(
    () => sortAgentsForSettings(visibleAgentsPreference.activeAgents),
    [visibleAgentsPreference.activeAgents],
  );
  const { iconSrcByAgentId, onAgentIconError } = useAgentIconSources(sortedAgents, apiClient);
  const placeholderByAgentId = useMemo(() => buildAgentPlaceholderMetaById(sortedAgents), [sortedAgents]);
  const allAgentRefs = useMemo(() => sortedAgents.map((agent) => getAgentRef(agent)), [sortedAgents]);

  const [draftPreference, setDraftPreference] = useState<VisibleAgentsPreferenceValue>(DEFAULT_VISIBLE_AGENTS_PREFERENCE);
  const [isDirty, setIsDirty] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Sinas - Settings";
  }, []);

  useEffect(() => {
    if (isDirty) return;
    setDraftPreference(visibleAgentsPreference.preference);
  }, [isDirty, visibleAgentsPreference.preference]);

  useEffect(() => {
    if (!selectionNotice) return;

    const timeoutId = window.setTimeout(() => {
      setSelectionNotice(null);
    }, 2400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectionNotice]);

  const effectiveVisibleRefs = useMemo(() => {
    if (draftPreference.mode === "all") return allAgentRefs;

    const refSet = new Set(allAgentRefs);
    return draftPreference.visibleAgentRefs.filter((ref) => refSet.has(ref));
  }, [allAgentRefs, draftPreference]);

  const effectiveVisibleRefSet = useMemo(() => new Set(effectiveVisibleRefs), [effectiveVisibleRefs]);
  const selectedCount = effectiveVisibleRefs.length;
  const totalAgentCount = sortedAgents.length;
  const hasUnsavedChanges = isDirty && !preferenceEquals(draftPreference, visibleAgentsPreference.preference);
  const hasInvalidEmptyCustomSelection = draftPreference.mode === "custom" && selectedCount === 0 && totalAgentCount > 0;
  const saveDisabled =
    !hasWorkspaceUrl ||
    agentsQuery.isLoading ||
    agentsQuery.isError ||
    statesQuery.isLoading ||
    statesQuery.isError ||
    visibleAgentsPreference.isSavingPreference ||
    hasInvalidEmptyCustomSelection ||
    !hasUnsavedChanges;

  function updateDraft(next: VisibleAgentsPreferenceValue) {
    visibleAgentsPreference.resetSavePreferenceError();
    setSaveMessage(null);
    setSelectionNotice(null);
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
    if (currentSet.has(ref)) {
      if (currentSet.size <= 1 && totalAgentCount > 0) {
        setSelectionNotice("At least one agent must remain visible so you can start a chat.");
        return;
      }
      currentSet.delete(ref);
    } else {
      currentSet.add(ref);
    }

    setCustomVisibleRefs(Array.from(currentSet));
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
                Choose which active agents are shown on the homepage.
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

            {selectionNotice ? (
              <div className={styles.noticeBox} role="status" aria-live="polite">
                <span>{selectionNotice}</span>
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
                  onClick={resetToDefault}
                  disabled={draftPreference.mode === "all" || agentsQuery.isLoading || statesQuery.isLoading}
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
                    const statusLabel = checked ? "Visible" : "Hidden";
                    const tone = getAgentTone(agent);
                    const placeholderCssVars = getPlaceholderCssVars(placeholderByAgentId[agent.id]);
                    const placeholderGlyphStyle = getPlaceholderGlyphStyle(placeholderByAgentId[agent.id]);
                    const shouldShowPlaceholder = !iconSrcByAgentId[agent.id] && Boolean(placeholderCssVars);

                    return (
                      <li key={agent.id} className={styles.agentRow}>
                        <label
                          className={joinClasses(
                            styles.agentLabel,
                            styles[`agentLabelTone${tone[0].toUpperCase()}${tone.slice(1)}`],
                          )}
                        >
                          <span className={styles.selectCheckbox}>
                            <input
                              className={styles.selectCheckboxInput}
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAgent(agentRef)}
                              disabled={visibleAgentsPreference.isSavingPreference}
                            />
                            <span className={styles.selectCheckboxControl} aria-hidden />
                          </span>
                          <span className={styles.agentMeta}>
                            <span className={styles.agentTopRow}>
                              <span className={styles.agentIdentity}>
                                <span
                                  className={joinClasses(
                                    styles.agentIconWrap,
                                    shouldShowPlaceholder && styles.agentIconWrapPlaceholder,
                                  )}
                                  style={shouldShowPlaceholder ? placeholderCssVars : undefined}
                                  aria-hidden
                                >
                                  {iconSrcByAgentId[agent.id] ? (
                                    <img
                                      className={styles.agentIconImage}
                                      src={iconSrcByAgentId[agent.id]}
                                      alt=""
                                      loading="lazy"
                                      onError={() => {
                                        void onAgentIconError(agent.id);
                                      }}
                                    />
                                  ) : shouldShowPlaceholder ? (
                                    <span className={styles.agentPlaceholderGlyph} style={placeholderGlyphStyle} />
                                  ) : (
                                    <Bot size={12} />
                                  )}
                                </span>
                                <span className={styles.agentName}>
                                  {agent.namespace} / {agent.name}
                                </span>
                              </span>
                              {agent.is_default ? <span className={styles.agentBadge}>Default</span> : null}
                            </span>
                            <span className={styles.agentRef}>{agentRef}</span>
                            <span className={styles.agentDescription}>{description}</span>
                          </span>
                          <span className={checked ? styles.visibilityPillVisible : styles.visibilityPillHidden}>
                            {statusLabel}
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
                {hasInvalidEmptyCustomSelection
                  ? "Select at least one agent."
                  : hasUnsavedChanges
                    ? "You have unsaved changes."
                    : "Changes are saved."}
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
