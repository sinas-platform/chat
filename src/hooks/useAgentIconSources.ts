import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseCollectionIconRef,
  resolveAgentIconSrc,
  resolveCollectionIconSrc,
  type AgentIconApiClient,
  type AgentIconDescriptor,
} from "../lib/agentIcons";

export type AgentIconEntry = AgentIconDescriptor & {
  id: string;
};

function getAgentIconSignature(agent: AgentIconEntry): string {
  return `${agent.icon_url ?? ""}\u0000${agent.icon ?? ""}`;
}

function removeAgentIconSrc(previous: Record<string, string>, agentId: string): Record<string, string> {
  if (!(agentId in previous)) return previous;

  const next = { ...previous };
  delete next[agentId];
  return next;
}

export function useAgentIconSources(agents: AgentIconEntry[], apiClient: AgentIconApiClient) {
  const [iconSrcByAgentId, setIconSrcByAgentId] = useState<Record<string, string>>({});
  const signaturesRef = useRef<Map<string, string>>(new Map());
  const activeAgentIdsRef = useRef<Set<string>>(new Set());
  const requestVersionByAgentIdRef = useRef<Record<string, number>>({});

  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent] as const)), [agents]);

  const setAgentIconSrc = useCallback((agentId: string, nextSrc: string | null) => {
    setIconSrcByAgentId((previous) => {
      if (!nextSrc) {
        return removeAgentIconSrc(previous, agentId);
      }

      if (previous[agentId] === nextSrc) return previous;
      return { ...previous, [agentId]: nextSrc };
    });
  }, []);

  const resolveAndCacheAgentIcon = useCallback(
    async (agent: AgentIconEntry, options: { forceCollectionRefresh?: boolean } = {}): Promise<string | null> => {
      const requestVersion = (requestVersionByAgentIdRef.current[agent.id] ?? 0) + 1;
      requestVersionByAgentIdRef.current[agent.id] = requestVersion;

      const isCollectionIcon = typeof agent.icon === "string" && parseCollectionIconRef(agent.icon) !== null;
      const resolvedSrc =
        options.forceCollectionRefresh && isCollectionIcon && agent.icon
          ? await resolveCollectionIconSrc(agent.icon, apiClient)
          : await resolveAgentIconSrc(agent, apiClient);

      const latestRequestVersion = requestVersionByAgentIdRef.current[agent.id];
      if (latestRequestVersion !== requestVersion) return null;
      if (!activeAgentIdsRef.current.has(agent.id)) return null;

      setAgentIconSrc(agent.id, resolvedSrc);
      return resolvedSrc;
    },
    [apiClient, setAgentIconSrc],
  );

  useEffect(() => {
    const nextSignatures = new Map(agents.map((agent) => [agent.id, getAgentIconSignature(agent)] as const));
    const previousSignatures = signaturesRef.current;
    const activeIds = new Set(nextSignatures.keys());
    activeAgentIdsRef.current = activeIds;

    const removedIds = Array.from(previousSignatures.keys()).filter((agentId) => !nextSignatures.has(agentId));
    if (removedIds.length > 0) {
      setIconSrcByAgentId((previous) => {
        let nextState = previous;
        removedIds.forEach((agentId) => {
          nextState = removeAgentIconSrc(nextState, agentId);
        });
        return nextState;
      });
    }

    agents.forEach((agent) => {
      const previousSignature = previousSignatures.get(agent.id);
      const nextSignature = nextSignatures.get(agent.id);
      if (previousSignature === nextSignature) return;
      void resolveAndCacheAgentIcon(agent);
    });

    signaturesRef.current = nextSignatures;
  }, [agents, resolveAndCacheAgentIcon]);

  const refreshAgentIcon = useCallback(
    async (agentId: string): Promise<string | null> => {
      const agent = agentsById.get(agentId);
      if (!agent) {
        setAgentIconSrc(agentId, null);
        return null;
      }

      return resolveAndCacheAgentIcon(agent, { forceCollectionRefresh: true });
    },
    [agentsById, resolveAndCacheAgentIcon, setAgentIconSrc],
  );

  const onAgentIconError = useCallback(
    async (agentId: string): Promise<string | null> => {
      const agent = agentsById.get(agentId);
      if (!agent) {
        setAgentIconSrc(agentId, null);
        return null;
      }

      // Signed file URLs can expire, so collection icons are regenerated when an image load fails.
      const hasCollectionRef = typeof agent.icon === "string" && parseCollectionIconRef(agent.icon) !== null;
      if (hasCollectionRef) {
        const refreshed = await resolveAndCacheAgentIcon(agent, { forceCollectionRefresh: true });
        if (refreshed) return refreshed;
      }

      // If refresh fails (or icon is not refreshable), clear src so UI falls back to placeholder icon.
      setAgentIconSrc(agent.id, null);
      return null;
    },
    [agentsById, resolveAndCacheAgentIcon, setAgentIconSrc],
  );

  return {
    iconSrcByAgentId,
    refreshAgentIcon,
    onAgentIconError,
  };
}
