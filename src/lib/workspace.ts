const LEGACY_WORKSPACE_KEY = "sinasWorkspaceUrl";
const WORKSPACE_CONFIG_KEY = "sinasWorkspaceConfig";
const WORKSPACE_CONFIG_VERSION = 1;
export const WORKSPACE_QUERY_CHANGE_EVENT = "sinas:workspace-query-change";

type StoredWorkspaceConfig = {
  version?: number;
  url?: string;
  applicationId?: string;
};

export type WorkspaceConfig = {
  url: string;
  applicationId?: string;
};

function normalizeWorkspaceUrl(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function normalizeApplicationId(value: string | null | undefined): string | undefined {
  const normalized = (value ?? "").trim();
  return normalized || undefined;
}

import { env } from "./env";

const DEFAULT_WORKSPACE = normalizeWorkspaceUrl(env("VITE_DEFAULT_WORKSPACE_URL")) || undefined;
const ENV_DEFAULT_APP_ID = normalizeApplicationId(env("VITE_DEFAULT_APPLICATION_ID"));

function readStoredWorkspaceConfig(): WorkspaceConfig | null {
  const raw = localStorage.getItem(WORKSPACE_CONFIG_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredWorkspaceConfig;
    const url = normalizeWorkspaceUrl(parsed.url);
    if (!url) {
      localStorage.removeItem(WORKSPACE_CONFIG_KEY);
      return null;
    }

    const applicationId = normalizeApplicationId(parsed.applicationId);
    return applicationId ? { url, applicationId } : { url };
  } catch {
    localStorage.removeItem(WORKSPACE_CONFIG_KEY);
    return null;
  }
}

function writeStoredWorkspaceConfig(config: WorkspaceConfig): void {
  const url = normalizeWorkspaceUrl(config.url);
  if (!url) {
    localStorage.removeItem(WORKSPACE_CONFIG_KEY);
    localStorage.removeItem(LEGACY_WORKSPACE_KEY);
    return;
  }

  const applicationId = normalizeApplicationId(config.applicationId);
  const payload: StoredWorkspaceConfig = {
    version: WORKSPACE_CONFIG_VERSION,
    url,
    ...(applicationId ? { applicationId } : {}),
  };

  localStorage.setItem(WORKSPACE_CONFIG_KEY, JSON.stringify(payload));
  localStorage.removeItem(LEGACY_WORKSPACE_KEY);
}

function migrateLegacyWorkspaceUrl(): WorkspaceConfig | null {
  const legacy = normalizeWorkspaceUrl(localStorage.getItem(LEGACY_WORKSPACE_KEY));
  if (!legacy) {
    localStorage.removeItem(LEGACY_WORKSPACE_KEY);
    return null;
  }

  const migrated: WorkspaceConfig = { url: legacy };
  writeStoredWorkspaceConfig(migrated);
  return migrated;
}

function getDefaultWorkspaceConfig(): WorkspaceConfig | null {
  if (!DEFAULT_WORKSPACE) return null;
  return ENV_DEFAULT_APP_ID ? { url: DEFAULT_WORKSPACE, applicationId: ENV_DEFAULT_APP_ID } : { url: DEFAULT_WORKSPACE };
}

function normalizeWorkspaceUrlFromQueryParam(value: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return normalizeWorkspaceUrl(parsed.toString());
  } catch {
    return "";
  }
}

function getLegacyWorkspaceConfigWithoutMigration(): WorkspaceConfig | null {
  const legacy = normalizeWorkspaceUrl(localStorage.getItem(LEGACY_WORKSPACE_KEY));
  if (!legacy) return null;
  return { url: legacy };
}

function getStoredWorkspaceConfigWithoutMigration(): WorkspaceConfig | null {
  return readStoredWorkspaceConfig() ?? getLegacyWorkspaceConfigWithoutMigration() ?? getDefaultWorkspaceConfig();
}

function getStoredWorkspaceConfigWithMigration(): WorkspaceConfig | null {
  return readStoredWorkspaceConfig() ?? migrateLegacyWorkspaceUrl() ?? getDefaultWorkspaceConfig();
}

export function getWorkspaceUrlFromQuery(search: string = typeof window !== "undefined" ? window.location.search : ""): string {
  const params = new URLSearchParams(search);
  return normalizeWorkspaceUrlFromQueryParam(params.get("ws"));
}

export function removeWorkspaceUrlFromSearch(search: string = typeof window !== "undefined" ? window.location.search : ""): string {
  const params = new URLSearchParams(search);
  params.delete("ws");
  const next = params.toString();
  return next ? `?${next}` : "";
}

function toCompactWorkspaceQueryValue(normalizedWorkspaceUrl: string): string {
  try {
    const parsed = new URL(normalizedWorkspaceUrl);
    const hasNonRootPath = parsed.pathname && parsed.pathname !== "/";
    return `${parsed.host}${hasNonRootPath ? parsed.pathname : ""}${parsed.search}${parsed.hash}`;
  } catch {
    return normalizedWorkspaceUrl.replace(/^https?:\/\//i, "");
  }
}

function encodeWorkspaceQueryValue(value: string): string {
  return encodeURIComponent(value)
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/");
}

function getWorkspaceConfigFromQuery(search: string = typeof window !== "undefined" ? window.location.search : ""): WorkspaceConfig | null {
  const url = getWorkspaceUrlFromQuery(search);
  if (!url) return null;

  const fallbackConfig = getStoredWorkspaceConfigWithoutMigration();
  const applicationId = normalizeApplicationId(fallbackConfig?.applicationId ?? ENV_DEFAULT_APP_ID);
  return applicationId ? { url, applicationId } : { url };
}

export function getWorkspaceConfig(): WorkspaceConfig | null {
  return getWorkspaceConfigFromQuery() ?? getStoredWorkspaceConfigWithMigration();
}

export function setWorkspaceConfig(config: WorkspaceConfig): void {
  writeStoredWorkspaceConfig(config);
}

export function setWorkspaceUrlInQuery(url: string): void {
  if (typeof window === "undefined") return;

  const normalized = normalizeWorkspaceUrlFromQueryParam(url);
  if (!normalized) return;

  const compactQueryValue = toCompactWorkspaceQueryValue(normalized);
  const currentUrl = new URL(window.location.href);
  const params = new URLSearchParams(currentUrl.search);
  params.delete("ws");
  const nonWorkspaceQuery = params.toString();
  const workspaceEntry = `ws=${encodeWorkspaceQueryValue(compactQueryValue)}`;
  const nextSearch = nonWorkspaceQuery ? `?${nonWorkspaceQuery}&${workspaceEntry}` : `?${workspaceEntry}`;

  const previousHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextHref = `${currentUrl.pathname}${nextSearch}${currentUrl.hash}`;
  if (previousHref === nextHref) return;

  window.history.replaceState(window.history.state, "", `${currentUrl.pathname}${nextSearch}${currentUrl.hash}`);
  // `history.replaceState` does not emit `popstate`; dispatch one so router/location subscribers observe the new query.
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  window.dispatchEvent(new Event(WORKSPACE_QUERY_CHANGE_EVENT));
}

export function getWorkspaceUrl(): string {
  return getWorkspaceConfig()?.url ?? "";
}

export function getApplicationId(): string | undefined {
  const appId = getWorkspaceConfig()?.applicationId ?? ENV_DEFAULT_APP_ID;
  return normalizeApplicationId(appId);
}

export function requireWorkspaceUrl(): string {
  const url = getWorkspaceUrl();
  if (!url) {
    throw new Error("Workspace URL is not configured. Please select a workspace first.");
  }
  return url;
}

export function setWorkspaceUrl(url: string) {
  const normalized = normalizeWorkspaceUrl(url);
  const existing = readStoredWorkspaceConfig() ?? migrateLegacyWorkspaceUrl();
  writeStoredWorkspaceConfig({
    url: normalized,
    ...(existing?.applicationId ? { applicationId: existing.applicationId } : {}),
  });
}

export function setWorkspaceApplicationId(applicationId?: string) {
  const url = getWorkspaceUrl();
  if (!url) {
    throw new Error("Workspace URL is not configured. Please select a workspace first.");
  }

  const normalizedApplicationId = normalizeApplicationId(applicationId);
  writeStoredWorkspaceConfig({
    url,
    ...(normalizedApplicationId ? { applicationId: normalizedApplicationId } : {}),
  });
}

export function clearWorkspace() {
  localStorage.removeItem(WORKSPACE_CONFIG_KEY);
  localStorage.removeItem(LEGACY_WORKSPACE_KEY);
}

export function clearWorkspaceUrl() {
  clearWorkspace();
}

export function hasWorkspace(): boolean {
  return getWorkspaceUrl().length > 0;
}
