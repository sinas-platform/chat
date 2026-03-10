import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Bot } from "lucide-react";

import styles from "./Settings.module.scss";
import { AppSidebar } from "../../components/AppSidebar/AppSidebar";
import { Button } from "../../components/Button/Button";
import { Input } from "../../components/Input/Input";
import { ThemeSwitch } from "../../components/ThemeSwitch/ThemeSwitch";
import { useAgentIconSources } from "../../hooks/useAgentIconSources";
import eyeIcon from "../../icons/eye.svg";
import eyeOffIcon from "../../icons/eye-off.svg";
import searchIcon from "../../icons/search.svg";
import { apiClient } from "../../lib/api";
import {
  DEFAULT_VISIBLE_AGENTS_PREFERENCE,
  getAgentRef,
  normalizeVisibleAgentsPreferenceValue,
  useVisibleAgentsPreference,
  type VisibleAgentsPreferenceValue,
} from "../../hooks/useVisibleAgentsPreference";
import { buildAgentPlaceholderMetaById, type AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import { getWorkspaceUrl } from "../../lib/workspace";
import type { AgentResponse } from "../../types";

function joinClasses(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(" ");
}

function sortAgentsForSettings<T extends { namespace: string; name: string }>(agents: T[]): T[] {
  return [...agents].sort((left, right) => {
    const leftLabel = `${left.name} ${left.namespace}`;
    const rightLabel = `${right.name} ${right.namespace}`;
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

function formatNamespaceLabel(namespace: string): string {
  const clean = namespace.trim().replace(/[_-]+/g, " ");
  if (!clean) return "Agent";

  return clean.replace(/\b\w/g, (char) => char.toUpperCase());
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
  const [searchValue, setSearchValue] = useState("");

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
  const hiddenCount = Math.max(0, totalAgentCount - selectedCount);
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

  const filteredAgents = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return sortedAgents;

    return sortedAgents.filter((agent) => {
      const haystack = `${agent.name} ${agent.namespace} ${agent.description ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [searchValue, sortedAgents]);

  const visibleAgents = useMemo(
    () => filteredAgents.filter((agent) => effectiveVisibleRefSet.has(getAgentRef(agent))),
    [effectiveVisibleRefSet, filteredAgents],
  );
  const hiddenAgents = useMemo(
    () => filteredAgents.filter((agent) => !effectiveVisibleRefSet.has(getAgentRef(agent))),
    [effectiveVisibleRefSet, filteredAgents],
  );

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

  function renderAgentList(agents: AgentResponse[], visibility: "visible" | "hidden") {
    if (agents.length === 0) {
      return (
        <div className={styles.emptyListState}>
          {searchValue.trim() ? "No agents match this search." : `No ${visibility} agents.`}
        </div>
      );
    }

    return (
      <ul className={styles.agentList}>
        {agents.map((agent) => {
          const agentRef = getAgentRef(agent);
          const isVisible = draftPreference.mode === "all" || effectiveVisibleRefSet.has(agentRef);
          const description = agent.description?.trim() || "No description available.";
          const placeholderCssVars = getPlaceholderCssVars(placeholderByAgentId[agent.id]);
          const placeholderGlyphStyle = getPlaceholderGlyphStyle(placeholderByAgentId[agent.id]);
          const iconSrc = iconSrcByAgentId[agent.id];

          return (
            <li key={agent.id}>
              <button
                type="button"
                className={joinClasses(styles.agentRowButton, !isVisible && styles.agentRowButtonHidden)}
                onClick={() => toggleAgent(agentRef)}
                disabled={visibleAgentsPreference.isSavingPreference}
                style={placeholderCssVars}
              >
                <span className={styles.agentMeta}>
                  <span className={styles.agentHeader}>
                    {iconSrc ? (
                      <img
                        className={joinClasses(styles.agentCustomIcon, !isVisible && styles.agentCustomIconHidden)}
                        src={iconSrc}
                        alt=""
                        loading="lazy"
                        aria-hidden
                        onError={() => {
                          void onAgentIconError(agent.id);
                        }}
                      />
                    ) : placeholderGlyphStyle ? (
                      <span
                        className={joinClasses(styles.agentPlaceholderGlyph, !isVisible && styles.agentIconHidden)}
                        style={placeholderGlyphStyle}
                        aria-hidden
                      />
                    ) : (
                      <Bot className={joinClasses(styles.agentIcon, !isVisible && styles.agentIconHidden)} size={20} aria-hidden />
                    )}
                    <span className={styles.agentName}>{agent.name}</span>
                    <span className={joinClasses(styles.agentTag, !isVisible && styles.agentTagHidden)}>
                      {formatNamespaceLabel(agent.namespace)}
                    </span>
                  </span>
                  <span className={styles.agentDescription}>{description}</span>
                </span>
                <span className={styles.agentAction}>
                  <img className={styles.agentActionIcon} src={isVisible ? eyeOffIcon : eyeIcon} alt="" aria-hidden />
                  <span className={styles.agentActionText}>{isVisible ? "Hide" : "Show"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={styles.layout}>
      <AppSidebar />

      <main className={styles.main}>
        <ThemeSwitch />

        <section className={styles.shell}>
          <header className={styles.pageHeader}>
            <h1 className={styles.title}>Settings</h1>
            <p className={styles.subtitle}>Manage what appears on your homepage</p>
          </header>

          <section className={styles.card} aria-labelledby="homepage-agents-title">
            <div className={styles.cardHeader}>
              <h2 id="homepage-agents-title" className={styles.cardTitle}>
                Homepage Agents
              </h2>
              <p className={styles.cardDescription}>
                Choose which active agents are shown on the homepage
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

            <Input
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search agents..."
              wrapperClassName={styles.searchField}
              className={styles.searchInput}
              startAction={<img className={styles.searchIcon} src={searchIcon} alt="" aria-hidden />}
              startActionClassName={styles.searchStartAction}
            />

            {agentsQuery.isLoading ? (
              <div className={styles.emptyListState}>Loading agents...</div>
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
              <div className={styles.emptyListState}>No active agents available.</div>
            ) : (
              <>
                <section className={styles.group} aria-labelledby="visible-homepage-agents-title">
                  <header className={styles.groupHeader}>
                    <h3 id="visible-homepage-agents-title" className={styles.groupTitle}>
                      Visible Homepage Agents
                    </h3>
                    <p className={styles.groupMeta}>
                      {selectedCount} visible agent{selectedCount === 1 ? "" : "s"} available
                    </p>
                  </header>
                  {renderAgentList(visibleAgents, "visible")}
                </section>

                <section className={styles.group} aria-labelledby="hidden-homepage-agents-title">
                  <header className={styles.groupHeader}>
                    <h3 id="hidden-homepage-agents-title" className={styles.groupTitle}>
                      Hidden Homepage Agents
                    </h3>
                    <p className={styles.groupMeta}>
                      {hiddenCount} hidden agent{hiddenCount === 1 ? "" : "s"}
                    </p>
                  </header>
                  {renderAgentList(hiddenAgents, "hidden")}
                </section>
              </>
            )}

            <div className={styles.footerActions}>
              <div className={styles.footerHint}>
                {hasInvalidEmptyCustomSelection
                  ? "Select at least one agent."
                  : hasUnsavedChanges
                    ? "You have unsaved changes."
                    : "Changes are saved."}
              </div>
              <Button variant="primary" className={styles.saveButton} onClick={() => void save()} disabled={saveDisabled}>
                {visibleAgentsPreference.isSavingPreference ? "Saving..." : "Save"}
              </Button>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
