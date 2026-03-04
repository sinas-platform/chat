import archIcon from "../icons/agentsPlaceholders/arch.svg";
import blobIcon from "../icons/agentsPlaceholders/blob.svg";
import circlesSquareIcon from "../icons/agentsPlaceholders/circles-square.svg";
import circlesVerticalIcon from "../icons/agentsPlaceholders/circles-vertical.svg";
import coilIcon from "../icons/agentsPlaceholders/coil.svg";
import ellipsesIcon from "../icons/agentsPlaceholders/ellipses.svg";
import halfCirclesIcon from "../icons/agentsPlaceholders/half-circles.svg";
import petalsIcon from "../icons/agentsPlaceholders/petals.svg";
import pinwheelIcon from "../icons/agentsPlaceholders/pinwheel.svg";
import semicirclesHorizontalIcon from "../icons/agentsPlaceholders/semicircles-horizontal.svg";
import semicirclesVerticalIcon from "../icons/agentsPlaceholders/semicircles-vertical.svg";
import sparkleIcon from "../icons/agentsPlaceholders/sparkle.svg";

type AgentColorId = "orange" | "pink" | "purple" | "violet" | "indigo" | "cyan" | "green" | "yellow";
type AgentIconId =
  | "arch"
  | "blob"
  | "circles-square"
  | "circles-vertical"
  | "coil"
  | "ellipses"
  | "half-circles"
  | "petals"
  | "pinwheel"
  | "semicircles-horizontal"
  | "semicircles-vertical"
  | "sparkle";

const AGENT_COLORS: Array<{ id: AgentColorId; color: string; softColor: string }> = [
  { id: "orange", color: "var(--color-palette-orange)", softColor: "var(--color-palette-orange-soft)" },
  { id: "pink", color: "var(--color-palette-pink)", softColor: "var(--color-palette-pink-soft)" },
  { id: "purple", color: "var(--color-palette-purple)", softColor: "var(--color-palette-purple-soft)" },
  { id: "violet", color: "var(--color-palette-violet)", softColor: "var(--color-palette-violet-soft)" },
  { id: "indigo", color: "var(--color-palette-indigo)", softColor: "var(--color-palette-indigo-soft)" },
  { id: "cyan", color: "var(--color-palette-cyan)", softColor: "var(--color-palette-cyan-soft)" },
  { id: "green", color: "var(--color-palette-green)", softColor: "var(--color-palette-green-soft)" },
  { id: "yellow", color: "var(--color-palette-yellow)", softColor: "var(--color-palette-yellow-soft)" },
];

const AGENT_ICONS: Array<{ id: AgentIconId; src: string }> = [
  { id: "arch", src: archIcon },
  { id: "blob", src: blobIcon },
  { id: "circles-square", src: circlesSquareIcon },
  { id: "circles-vertical", src: circlesVerticalIcon },
  { id: "coil", src: coilIcon },
  { id: "ellipses", src: ellipsesIcon },
  { id: "half-circles", src: halfCirclesIcon },
  { id: "petals", src: petalsIcon },
  { id: "pinwheel", src: pinwheelIcon },
  { id: "semicircles-horizontal", src: semicirclesHorizontalIcon },
  { id: "semicircles-vertical", src: semicirclesVerticalIcon },
  { id: "sparkle", src: sparkleIcon },
];

const ICON_INDEX_BY_ID = new Map(AGENT_ICONS.map((icon, index) => [icon.id, index] as const));
const COLOR_INDEX_BY_ID = new Map(AGENT_COLORS.map((color, index) => [color.id, index] as const));

type PlaceholderOverride = {
  matches: (agent: AgentPlaceholderAgent) => boolean;
  iconId: AgentIconId;
  colorId: AgentColorId;
};

const PLACEHOLDER_OVERRIDES: PlaceholderOverride[] = [
  {
    matches: (agent) => normalizeAgentName(agent.name).includes("futurist"),
    iconId: "sparkle",
    colorId: "orange",
  },
  {
    matches: (agent) => {
      const name = normalizeAgentName(agent.name);
      return name.includes("mistral test");
    },
    iconId: "circles-square",
    colorId: "violet",
  },
  {
    matches: (agent) => {
      const name = normalizeAgentName(agent.name);
      return name.includes("pulsr news editor");
    },
    iconId: "arch",
    colorId: "indigo",
  },
];

export type AgentPlaceholderAgent = {
  id: string;
  namespace: string;
  name: string;
};

export type AgentPlaceholderMeta = {
  iconSrc: string;
  color: string;
  softColor: string;
};

function normalizeAgentName(value: string): string {
  return value.trim().toLowerCase();
}

function getAgentSortKey(agent: AgentPlaceholderAgent): string {
  return `${agent.namespace.toLowerCase()}::${agent.name.toLowerCase()}::${agent.id}`;
}

function getAgentIdentityKey(agent: AgentPlaceholderAgent): string {
  return `${agent.namespace.toLowerCase()}::${agent.name.toLowerCase()}::${agent.id}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getFirstAvailableIconIndex(preferredIndex: number, used: Set<number>): number {
  if (used.size >= AGENT_ICONS.length) return preferredIndex;

  let candidate = preferredIndex;
  for (let offset = 0; offset < AGENT_ICONS.length; offset += 1) {
    if (!used.has(candidate)) return candidate;
    candidate = (candidate + 1) % AGENT_ICONS.length;
  }

  return preferredIndex;
}

function findPlaceholderOverride(agent: AgentPlaceholderAgent): PlaceholderOverride | null {
  for (const override of PLACEHOLDER_OVERRIDES) {
    if (override.matches(agent)) return override;
  }

  return null;
}

export function buildAgentPlaceholderMetaById(agents: AgentPlaceholderAgent[]): Record<string, AgentPlaceholderMeta> {
  const sortedAgents = [...agents].sort((left, right) => getAgentSortKey(left).localeCompare(getAgentSortKey(right)));
  const iconIndexByAgentId = new Map<string, number>();
  const colorIndexByAgentId = new Map<string, number>();
  const usedIconIndices = new Set<number>();
  const pendingAgents: AgentPlaceholderAgent[] = [];

  sortedAgents.forEach((agent) => {
    const override = findPlaceholderOverride(agent);
    if (!override) {
      pendingAgents.push(agent);
      return;
    }

    const overrideIconIndex = ICON_INDEX_BY_ID.get(override.iconId);
    const overrideColorIndex = COLOR_INDEX_BY_ID.get(override.colorId);

    if (overrideColorIndex != null) {
      colorIndexByAgentId.set(agent.id, overrideColorIndex);
    }

    if (overrideIconIndex == null) {
      pendingAgents.push(agent);
      return;
    }

    if (usedIconIndices.size < AGENT_ICONS.length && usedIconIndices.has(overrideIconIndex)) {
      pendingAgents.push(agent);
      return;
    }

    iconIndexByAgentId.set(agent.id, overrideIconIndex);
    usedIconIndices.add(overrideIconIndex);
  });

  // Keep icon assignments unique until we exhaust all 12 placeholders, then start cycling.
  pendingAgents.forEach((agent) => {
    const identityKey = getAgentIdentityKey(agent);
    const preferredIconIndex = hashString(identityKey) % AGENT_ICONS.length;
    const iconIndex = getFirstAvailableIconIndex(preferredIconIndex, usedIconIndices);

    if (usedIconIndices.size < AGENT_ICONS.length) {
      usedIconIndices.add(iconIndex);
    }

    iconIndexByAgentId.set(agent.id, iconIndex);

    if (!colorIndexByAgentId.has(agent.id)) {
      const colorIndex = hashString(`${identityKey}:color`) % AGENT_COLORS.length;
      colorIndexByAgentId.set(agent.id, colorIndex);
    }
  });

  const placeholderByAgentId: Record<string, AgentPlaceholderMeta> = {};
  sortedAgents.forEach((agent) => {
    const iconIndex = iconIndexByAgentId.get(agent.id) ?? 0;
    const colorIndex = colorIndexByAgentId.get(agent.id) ?? 0;

    const icon = AGENT_ICONS[iconIndex] ?? AGENT_ICONS[0];
    const color = AGENT_COLORS[colorIndex] ?? AGENT_COLORS[0];
    if (!icon || !color) return;

    placeholderByAgentId[agent.id] = {
      iconSrc: icon.src,
      color: color.color,
      softColor: color.softColor,
    };
  });

  return placeholderByAgentId;
}
