import type { TempUrlResponse } from "./files/types";

export type AgentIconDescriptor = {
  icon?: string | null;
  icon_url?: string | null;
};

export type CollectionIconRef = {
  namespace: string;
  collection: string;
  filename: string;
};

export type AgentIconApiClient = {
  generateFileTempUrl: (
    namespace: string,
    collection: string,
    filename: string,
    options?: { expiresIn?: number; version?: number }
  ) => Promise<TempUrlResponse | string>;
};

const ICON_URL_PREFIX = "url:";
const ICON_COLLECTION_PREFIX = "collection:";

function extractSignedUrl(value: TempUrlResponse | string): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (!value || typeof value !== "object") return null;

  const maybeUrl = value.url ?? value.signed_url ?? value.data_url;
  if (typeof maybeUrl !== "string") return null;

  const trimmed = maybeUrl.trim();
  return trimmed || null;
}

export function parseCollectionIconRef(icon: string): CollectionIconRef | null {
  const trimmed = icon.trim();
  if (!trimmed.startsWith(ICON_COLLECTION_PREFIX)) return null;

  const rawRef = trimmed.slice(ICON_COLLECTION_PREFIX.length).trim();
  if (!rawRef) return null;

  const segments = rawRef.split("/");
  if (segments.length < 3) return null;

  const [namespace, collection, ...filenameParts] = segments;
  const filename = filenameParts.join("/");

  if (!namespace || !collection || !filename) return null;

  return { namespace, collection, filename };
}

export async function resolveCollectionIconSrc(
  icon: string,
  apiClient: AgentIconApiClient,
): Promise<string | null> {
  const parsed = parseCollectionIconRef(icon);
  if (!parsed) return null;

  try {
    const response = await apiClient.generateFileTempUrl(parsed.namespace, parsed.collection, parsed.filename);
    return extractSignedUrl(response);
  } catch {
    return null;
  }
}

export async function resolveAgentIconSrc(
  agent: AgentIconDescriptor,
  apiClient: AgentIconApiClient,
): Promise<string | null> {
  const iconUrl = agent.icon_url?.trim();
  if (iconUrl) return iconUrl;

  const iconRef = agent.icon?.trim();
  if (!iconRef) return null;

  if (iconRef.startsWith(ICON_URL_PREFIX)) {
    const directUrl = iconRef.slice(ICON_URL_PREFIX.length).trim();
    return directUrl || null;
  }

  if (iconRef.startsWith(ICON_COLLECTION_PREFIX)) {
    return resolveCollectionIconSrc(iconRef, apiClient);
  }

  return null;
}
