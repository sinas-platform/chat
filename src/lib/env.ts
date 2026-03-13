type EnvKeys =
  | "VITE_DEFAULT_WORKSPACE_URL"
  | "VITE_DEFAULT_APPLICATION_ID"
  | "VITE_X_API_KEY"
  | "VITE_FILES_NAMESPACE"
  | "VITE_FILES_COLLECTION";

declare global {
  interface Window {
    __ENV__?: Partial<Record<EnvKeys, string>>;
  }
}

function isPlaceholder(value: string | undefined): boolean {
  return !value || /^__.*__$/.test(value);
}

/**
 * Reads an env variable at runtime from window.__ENV__ (injected at serve
 * time), falling back to the Vite build-time value from import.meta.env.
 * Placeholder strings like "__VITE_DEFAULT_WORKSPACE_URL__" are treated as
 * unset so local dev (without the Docker entrypoint) still works.
 */
export function env(key: EnvKeys): string | undefined {
  const runtime = window.__ENV__?.[key];
  if (runtime && !isPlaceholder(runtime)) return runtime;

  const buildTime = (import.meta.env[key] as string | undefined)?.trim();
  return buildTime || undefined;
}
