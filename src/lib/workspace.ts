const WORKSPACE_KEY = "sinasWorkspaceUrl";

const DEFAULT_WORKSPACE =
  (import.meta.env.VITE_DEFAULT_WORKSPACE_URL as string | undefined)?.replace(/\/+$/, "") ??
  "https://pulsr.sinas.cloud";

export function getWorkspaceUrl(): string {
  const stored = localStorage.getItem(WORKSPACE_KEY);
  return (stored || DEFAULT_WORKSPACE).replace(/\/+$/, "");
}

export function setWorkspaceUrl(url: string) {
  const normalized = url.trim().replace(/\/+$/, "");
  localStorage.setItem(WORKSPACE_KEY, normalized);
}

export function clearWorkspaceUrl() {
  localStorage.removeItem(WORKSPACE_KEY);
}

export function hasWorkspace(): boolean {
  return !!localStorage.getItem(WORKSPACE_KEY);
}
