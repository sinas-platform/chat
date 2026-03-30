import type { CSSProperties } from "react";

import type { AgentPlaceholderMeta } from "../../lib/agentPlaceholders";
import { UploadChatAttachmentError } from "../../lib/files/filesService";
import type { ChatAttachment } from "../../lib/files/types";
import { getWorkspaceUrl } from "../../lib/workspace";
import type { ApprovalRequiredEvent } from "../../types";

export type AudioAttachmentFormat = "wav" | "mp3" | "m4a" | "ogg";

export type ChatMessageViewModel = {
  id?: string | null;
  role?: string | null;
  content?: unknown;
  created_at?: string | null;
};

export type RenderedMessageAttachment = {
  kind: "image" | "file" | "audio";
  url?: string;
  name?: string;
  mime?: string;
  format?: AudioAttachmentFormat;
};

export type ParsedMessageContent = {
  text: string;
  attachments: RenderedMessageAttachment[];
};

export type SinasComponentToolPayload = {
  type: "component";
  namespace: string;
  name: string;
  render_token: string;
  title?: string;
  input?: unknown;
  compile_status?: string;
};

export type HtmlPreviewPayload = {
  html: string;
  subject?: string;
  text?: string;
};

export type ToolRunStatus = "running" | "done" | "error";

export interface ToolRun {
  id: string;
  name: string;
  description: string;
  status: ToolRunStatus;
  startedAt: string;
  error?: string | null;
}

export type PendingChatAttachment =
  | {
      kind: "uploaded";
      attachment: ChatAttachment;
    }
  | {
      kind: "audio";
      audio: {
        name: string;
        mime: string;
        size: number;
        format: AudioAttachmentFormat;
        base64: string;
        added_at: string;
      };
    };

export const DEFAULT_ATTACHMENT_ERROR = "File uploads aren’t configured on this Sinas instance. Ask admin to configure it.";
export const AUDIO_ATTACHMENTS_ENABLED = true;
export const AUDIO_ATTACHMENTS_DISABLED_ERROR = "Audio attachments are not supported yet.";
export const UNSUPPORTED_AUDIO_ERROR = "Unsupported audio format. Please use WAV, MP3, M4A, or OGG.";
const SUPPORTED_AUDIO_FORMATS = new Set<AudioAttachmentFormat>(["wav", "mp3", "m4a", "ogg"]);

export const CHAT_ATTACHMENT_ACCEPT = "image/*,audio/*,.wav,.mp3,.m4a,.ogg,.pdf,.doc,.docx,.txt";
export const CHAT_SCROLL_TOP_OFFSET = 16;
export const CHAT_NEAR_BOTTOM_THRESHOLD = 72;

export function joinClasses(...classNames: Array<string | undefined | false>): string {
  return classNames.filter(Boolean).join(" ");
}

export function getPlaceholderCssVars(placeholder: AgentPlaceholderMeta | undefined): CSSProperties | undefined {
  if (!placeholder) return undefined;

  return {
    "--agent-icon-color": placeholder.color,
    "--agent-icon-soft-color": placeholder.softColor,
  } as CSSProperties;
}

export function getPlaceholderGlyphStyle(placeholder: AgentPlaceholderMeta | undefined): CSSProperties | undefined {
  if (!placeholder) return undefined;

  const iconUrl = `url("${placeholder.iconSrc}")`;
  return {
    WebkitMaskImage: iconUrl,
    maskImage: iconUrl,
  } as CSSProperties;
}

function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filename.length - 1) return "";
  return filename.slice(dotIndex + 1).toLowerCase();
}

export function isAudioCandidate(file: File): boolean {
  if (file.type.toLowerCase().startsWith("audio/")) return true;
  return SUPPORTED_AUDIO_FORMATS.has(getFileExtension(file.name) as AudioAttachmentFormat);
}

export function normalizeAudioFormat(file: File): AudioAttachmentFormat | null {
  const mime = file.type.toLowerCase();
  const ext = getFileExtension(file.name);

  if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
  if (mime === "audio/mp4" || mime === "audio/m4a" || mime === "audio/x-m4a") return "m4a";
  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav" || mime === "audio/vnd.wave") return "wav";
  if (mime === "audio/ogg" || mime === "application/ogg") return "ogg";

  if (ext === "mp3") return "mp3";
  if (ext === "m4a") return "m4a";
  if (ext === "wav") return "wav";
  if (ext === "ogg") return "ogg";

  return null;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read file data"));
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1 || commaIndex === dataUrl.length - 1) {
    throw new Error("Invalid file data");
  }
  return dataUrl.slice(commaIndex + 1);
}

export function getAttachmentErrorMessage(error: unknown): string {
  if (error instanceof UploadChatAttachmentError) {
    if (error.code === "file_too_large") return "File is too large. Max size is 20 MB.";
    if (error.code === "no_permission") return "No permission to upload files";
    return DEFAULT_ATTACHMENT_ERROR;
  }

  return DEFAULT_ATTACHMENT_ERROR;
}

export function getAudioAttachmentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not process audio file.";
}

export function normalizeToolName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "tool";
}

export function getToolDescription(description: string | null | undefined, toolName: string): string {
  const trimmed = description?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `Running ${toolName}`;
}

export function getApprovalReason(approval: ApprovalRequiredEvent): string {
  const args = approval.arguments ?? {};
  const candidates = [args.justification, args.reason, args.description, args.message, args.purpose];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }

  return "The assistant needs your permission to continue with the next action.";
}

export function extractToolCallId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const directId = (value as { tool_call_id?: unknown }).tool_call_id;
  if (typeof directId === "string" && directId.trim().length > 0) {
    return directId;
  }

  const nestedError = (value as { error?: unknown }).error;
  if (nestedError && typeof nestedError === "object") {
    const nestedId = (nestedError as { tool_call_id?: unknown }).tool_call_id;
    if (typeof nestedId === "string" && nestedId.trim().length > 0) {
      return nestedId;
    }
  }

  return null;
}

export function extractErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value instanceof Error) {
    const trimmed = value.message.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === "object") {
    const directMessage = (value as { message?: unknown }).message;
    if (typeof directMessage === "string" && directMessage.trim().length > 0) {
      return directMessage.trim();
    }

    const directError = (value as { error?: unknown }).error;
    if (typeof directError === "string" && directError.trim().length > 0) {
      return directError.trim();
    }

    if (directError && typeof directError === "object") {
      const nestedMessage = (directError as { message?: unknown }).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
        return nestedMessage.trim();
      }
    }
  }

  return null;
}

function tryParseStructuredContentString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;

    const hasStructuredParts = parsed.some((item) => {
      if (!item || typeof item !== "object") return false;
      const type = (item as { type?: unknown }).type;
      return type === "text" || type === "image" || type === "file" || type === "audio";
    });

    return hasStructuredParts ? parsed : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const TOOL_PAYLOAD_WRAPPER_KEYS = ["result", "payload", "content", "data", "output", "response", "value"] as const;

function looksLikeJsonString(value: string): boolean {
  if (!value) return false;
  const firstChar = value[0];
  return firstChar === "{" || firstChar === "[" || firstChar === "\"";
}

export function tryParseJsonString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!looksLikeJsonString(trimmed)) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function normalizeToolPayload(content: unknown, depth = 0): unknown {
  if (depth > 5) return content;

  if (typeof content !== "string") return content;
  const parsed = tryParseJsonString(content);
  if (parsed === null) return content;
  return normalizeToolPayload(parsed, depth + 1);
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMeaningfulHtmlString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return /<!doctype\s+html|<html[\s>]|<body[\s>]|<(table|div|p|section|article|header|footer|main|h1|h2|h3|h4|ul|ol|li|span|br)\b/i.test(
    trimmed,
  );
}

function toHtmlPreviewPayload(value: unknown): HtmlPreviewPayload | null {
  const record = asRecord(value);
  if (!record) return null;

  const normalizedHtmlValue = normalizeToolPayload(record.html);
  const html = getNonEmptyString(normalizedHtmlValue);
  if (!html || !isMeaningfulHtmlString(html)) return null;

  const normalizedSubject = normalizeToolPayload(record.subject);
  const normalizedTitle = normalizeToolPayload(record.title);
  const normalizedText = normalizeToolPayload(record.text);
  const subject = getNonEmptyString(normalizedSubject) ?? getNonEmptyString(normalizedTitle) ?? undefined;
  const text = getNonEmptyString(normalizedText) ?? undefined;

  return { html: html.trim(), subject, text };
}

export function extractHtmlPreview(content: unknown, depth = 0): HtmlPreviewPayload | null {
  if (depth > 6) return null;

  const normalizedContent = normalizeToolPayload(content);
  if (normalizedContent !== content) {
    return extractHtmlPreview(normalizedContent, depth + 1);
  }

  const directPayload = toHtmlPreviewPayload(content);
  if (directPayload) return directPayload;

  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.length === 0) return null;
    return isMeaningfulHtmlString(trimmed) ? { html: trimmed } : null;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      const payload = extractHtmlPreview(item, depth + 1);
      if (payload) return payload;

      if (!item || typeof item !== "object") continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== "string") continue;

      const textPayload = extractHtmlPreview(text, depth + 1);
      if (textPayload) return textPayload;
    }
    return null;
  }

  const record = asRecord(content);
  if (!record) return null;

  const parentSubject = getNonEmptyString(normalizeToolPayload(record.subject)) ?? getNonEmptyString(normalizeToolPayload(record.title)) ?? undefined;
  const parentText = getNonEmptyString(normalizeToolPayload(record.text)) ?? undefined;

  for (const key of TOOL_PAYLOAD_WRAPPER_KEYS) {
    const candidate = record[key];
    if (candidate === undefined) continue;
    const nestedPayload = extractHtmlPreview(candidate, depth + 1);
    if (nestedPayload) {
      return {
        html: nestedPayload.html,
        subject: nestedPayload.subject ?? parentSubject,
        text: nestedPayload.text ?? parentText,
      };
    }
  }

  return null;
}

function toSinasComponentToolPayload(value: unknown): SinasComponentToolPayload | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.type !== "component") return null;

  const namespace = typeof record.namespace === "string" ? record.namespace.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const renderToken = typeof record.render_token === "string" ? record.render_token.trim() : "";
  if (!namespace || !name || !renderToken) return null;

  return {
    type: "component",
    namespace,
    name,
    render_token: renderToken,
    title: typeof record.title === "string" ? record.title : undefined,
    input: record.input,
    compile_status: typeof record.compile_status === "string" ? record.compile_status : undefined,
  };
}

export function parseSinasComponentToolPayload(content: unknown, depth = 0): SinasComponentToolPayload | null {
  if (depth > 2) return null;

  const directPayload = toSinasComponentToolPayload(content);
  if (directPayload) return directPayload;

  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

    try {
      const parsed = JSON.parse(trimmed);
      return parseSinasComponentToolPayload(parsed, depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      const payload = parseSinasComponentToolPayload(item, depth + 1);
      if (payload) return payload;

      if (!item || typeof item !== "object") continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== "string") continue;

      const textPayload = parseSinasComponentToolPayload(text, depth + 1);
      if (textPayload) return textPayload;
    }
    return null;
  }

  const record = asRecord(content);
  if (!record) return null;

  const nestedCandidates = [record.result, record.payload, record.content, record.data];
  for (const candidate of nestedCandidates) {
    const nestedPayload = parseSinasComponentToolPayload(candidate, depth + 1);
    if (nestedPayload) return nestedPayload;
  }

  return null;
}

export function getSinasComponentRenderSrc(payload: SinasComponentToolPayload): string {
  const params = new URLSearchParams({ token: payload.render_token });
  if (payload.input !== undefined) {
    try {
      params.set("input", JSON.stringify(payload.input));
    } catch {
      // Ignore non-serializable input payloads and render with token only.
    }
  }

  const workspaceBaseUrl = getWorkspaceUrl().replace(/\/+$/, "");
  const componentPath = `/components/${encodeURIComponent(payload.namespace)}/${encodeURIComponent(payload.name)}/render`;
  if (!workspaceBaseUrl) {
    return `${componentPath}?${params.toString()}`;
  }

  return `${workspaceBaseUrl}${componentPath}?${params.toString()}`;
}

export function getMessageText(content: unknown): string {
  if (typeof content === "string") {
    const parsed = tryParseStructuredContentString(content);
    if (parsed) return getMessageText(parsed);
    return content;
  }
  if (content == null) return "";

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          if (typeof text === "string") return text;
        }
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      })
      .join("\n");
  }

  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || "Attachment";
  } catch {
    const segments = url.split("/").filter(Boolean);
    return segments[segments.length - 1] || "Attachment";
  }
}

export function parseMessageContent(content: unknown): ParsedMessageContent {
  if (typeof content === "string") {
    const parsed = tryParseStructuredContentString(content);
    if (parsed) return parseMessageContent(parsed);
    return { text: content, attachments: [] };
  }

  if (content == null) {
    return { text: "", attachments: [] };
  }

  if (!Array.isArray(content)) {
    return { text: getMessageText(content), attachments: [] };
  }

  const textParts: string[] = [];
  const attachments: RenderedMessageAttachment[] = [];

  for (const item of content) {
    if (typeof item === "string") {
      textParts.push(item);
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }

    const part = item as Record<string, unknown>;
    const type = typeof part.type === "string" ? part.type : undefined;

    if (type === "text") {
      const text = part.text;
      if (typeof text === "string" && text.length > 0) {
        textParts.push(text);
      }
      continue;
    }

    if (type === "image") {
      const imageUrl = part.image;
      if (typeof imageUrl === "string" && imageUrl.length > 0) {
        attachments.push({
          kind: "image",
          url: imageUrl,
        });
      }
      continue;
    }

    if (type === "file") {
      const fileUrl = typeof part.file_url === "string" ? part.file_url : part.file;
      if (typeof fileUrl === "string" && fileUrl.length > 0) {
        attachments.push({
          kind: "file",
          url: fileUrl,
          name: typeof part.filename === "string" ? part.filename : typeof part.name === "string" ? part.name : getFilenameFromUrl(fileUrl),
          mime: typeof part.mime_type === "string" ? part.mime_type : typeof part.mime === "string" ? part.mime : undefined,
        });
      }
      continue;
    }

    if (type === "audio") {
      const format = typeof part.format === "string" ? part.format.toLowerCase() : "";
      if (SUPPORTED_AUDIO_FORMATS.has(format as AudioAttachmentFormat)) {
        attachments.push({
          kind: "audio",
          name: typeof part.name === "string" ? part.name : "Audio attachment",
          format: format as AudioAttachmentFormat,
        });
      } else {
        attachments.push({
          kind: "audio",
          name: "Audio attachment",
        });
      }
      continue;
    }

    const text = part.text;
    if (typeof text === "string" && text.length > 0) {
      textParts.push(text);
    }
  }

  return {
    text: textParts.join("\n"),
    attachments,
  };
}

function hasRenderableMessageContent(content: unknown): boolean {
  const parsed = parseMessageContent(content);
  return parsed.text.trim().length > 0 || parsed.attachments.length > 0;
}

export function shouldRenderMessage(message: ChatMessageViewModel): boolean {
  if (message.role === "tool") {
    return parseSinasComponentToolPayload(message.content) !== null || extractHtmlPreview(message.content) !== null;
  }

  // Hide assistant tool-call scaffolding messages that have no visible text/attachments.
  if (message.role === "assistant" && !hasRenderableMessageContent(message.content)) {
    return false;
  }

  return true;
}
