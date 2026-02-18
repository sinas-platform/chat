export type AgentOption = {
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  tone: "yellow" | "blue" | "mint";
  askHint: string;
};

export const AGENT_OPTIONS: AgentOption[] = [
  {
    id: "mistral-test-nl",
    namespace: "default",
    name: "Mistral Test NL",
    displayName: "Mistral Test NL",
    description: "General purpose assistant for broad questions.",
    tone: "yellow",
    askHint: "research, writing and everyday questions",
  },
  {
    id: "futurist-agent",
    namespace: "default",
    name: "futurist agent",
    displayName: "Futurist",
    description: "Trend and strategy oriented assistant.",
    tone: "blue",
    askHint: "trends, scenarios and strategic direction",
  },
  {
    id: "pulsr-news-editor",
    namespace: "Marketing",
    name: "pulsr news editor",
    displayName: "Pulsr News Editor",
    description: "Marketing-focused editor for news copy.",
    tone: "mint",
    askHint: "headlines, tone and concise marketing copy",
  },
];

const SELECTED_AGENT_STORAGE_KEY = "chat.selected_agent_id";
const DEFAULT_AGENT_ID = "mistral-test-nl";

const agentById = new Map(AGENT_OPTIONS.map((agent) => [agent.id, agent]));
const agentByEndpointKey = new Map(
  AGENT_OPTIONS.map((agent) => [`${agent.namespace.toLowerCase()}::${agent.name.toLowerCase()}`, agent]),
);

function toEndpointKey(namespace?: string | null, name?: string | null) {
  if (!namespace || !name) return null;
  return `${namespace.toLowerCase()}::${name.toLowerCase()}`;
}

export function getAgentById(agentId?: string | null): AgentOption | undefined {
  if (!agentId) return undefined;
  return agentById.get(agentId);
}

export function getAgentByNamespaceAndName(
  namespace?: string | null,
  name?: string | null,
): AgentOption | undefined {
  const key = toEndpointKey(namespace, name);
  if (!key) return undefined;
  return agentByEndpointKey.get(key);
}

export function getDefaultAgent(): AgentOption {
  const defaultAgent = getAgentById(DEFAULT_AGENT_ID);
  return defaultAgent ?? AGENT_OPTIONS[0]!;
}

export function getSelectedAgent(): AgentOption {
  if (typeof window === "undefined") return getDefaultAgent();

  try {
    const storedId = window.localStorage.getItem(SELECTED_AGENT_STORAGE_KEY);
    return getAgentById(storedId) ?? getDefaultAgent();
  } catch {
    return getDefaultAgent();
  }
}

export function saveSelectedAgentId(agentId: string): void {
  if (!getAgentById(agentId)) return;
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SELECTED_AGENT_STORAGE_KEY, agentId);
  } catch {
    // Ignore storage failures and keep in-memory selection.
  }
}
