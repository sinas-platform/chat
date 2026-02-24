const LEGACY_WORKSPACE_KEY = "sinasWorkspaceUrl";
const WORKSPACE_CONFIG_KEY = "sinasWorkspaceConfig";
const WORKSPACE_CONFIG_VERSION = 1;

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

const DEFAULT_WORKSPACE = normalizeWorkspaceUrl(import.meta.env.VITE_DEFAULT_WORKSPACE_URL as string | undefined) || undefined;
const ENV_DEFAULT_APP_ID = normalizeApplicationId(import.meta.env.VITE_DEFAULT_APPLICATION_ID as string | undefined);

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

export function getWorkspaceConfig(): WorkspaceConfig | null {
  return readStoredWorkspaceConfig() ?? migrateLegacyWorkspaceUrl() ?? getDefaultWorkspaceConfig();
}

export function setWorkspaceConfig(config: WorkspaceConfig): void {
  writeStoredWorkspaceConfig(config);
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
