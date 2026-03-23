import axios, { type AxiosError, type AxiosInstance } from "axios";
import { env } from "./env";
import { getWorkspaceUrl, requireWorkspaceUrl } from "./workspace";
import { clearAuth, getAuthToken, getRefreshToken, setAuthToken } from "./authStorage";
import type { ChatAttachment, FileResponse, FileUpload, TempUrlResponse } from "./files/types";

import type {
  ApprovalRequiredEvent,
  AgentResponse,
  Chat,
  ChatCreate,
  ChatWithMessages,
  CreatePreferenceStateRequest,
  LoginRequest,
  LoginResponse,
  Message,
  MessageSendRequest,
  OTPVerifyRequest,
  OTPVerifyResponse,
  PreferenceStateRecord,
  ToolApprovalRequest,
  ToolApprovalResponse,
  ToolEndEvent,
  ToolStartEvent,
  UpdatePreferenceStateRequest,
  User,
} from "../types";

type RefreshResponse = { access_token: string; expires_in: number };
type StreamChunkMode = "append" | "replace";

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const normalized = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return normalized || getWorkspaceUrl() || undefined;
}

function redirectToLoginIfNeeded(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  window.location.href = "/login";
}

function getRuntimeApiKey(): string | null {
  return env("VITE_X_API_KEY")?.trim() || null;
}

export type MessageStreamChunk = {
  text: string;
  mode: StreamChunkMode;
  event: string;
  raw: unknown;
};

export type ChatStreamHandlers = {
  onChunkContent?: (text: string) => void;
  onApprovalRequired?: (event: ApprovalRequiredEvent) => void;
  onToolStart?: (event: ToolStartEvent) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
};

export type ChatStreamHandle = {
  abort: () => void;
  done: Promise<void>;
};

type SendMessageStreamOptions = {
  signal?: AbortSignal;
  onChunk?: (chunk: MessageStreamChunk) => void;
};

class APIClient {
  private client: AxiosInstance;

  private isRefreshing = false;
  private failedQueue: Array<{
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  constructor() {
    this.client = axios.create({
      baseURL: normalizeBaseUrl(),
      headers: { "Content-Type": "application/json" },
    });

    this.setupInterceptors();
  }

  setWorkspaceBaseUrl(baseUrl?: string) {
    this.client.defaults.baseURL = normalizeBaseUrl(baseUrl);
  }

  private setupInterceptors() {
    this.client.interceptors.request.use((config) => {
      const ws = getWorkspaceUrl();
      if (!ws) {
        throw new Error("Workspace URL is not configured. Please select a workspace first.");
      }

      const token = getAuthToken(ws);
      const runtimeApiKey = getRuntimeApiKey();

      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
      }

      if (runtimeApiKey) {
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>)["X-API-Key"] = runtimeApiKey;
      }

      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;

        if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
          if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
              this.failedQueue.push({ resolve, reject });
            }).then(() => this.client(originalRequest));
          }

          originalRequest._retry = true;
          this.isRefreshing = true;

          const ws = getWorkspaceUrl();
          const refreshToken = getRefreshToken(ws);

          if (!refreshToken) {
            clearAuth(ws);
            redirectToLoginIfNeeded();
            return Promise.reject(error);
          }

          try {
            const refreshed = await this.refreshToken(refreshToken);
            setAuthToken(ws, refreshed.access_token);

            this.processQueue(null);

            originalRequest.headers = originalRequest.headers ?? {};
            (originalRequest.headers as Record<string, string>).Authorization = `Bearer ${refreshed.access_token}`;

            return this.client(originalRequest);
          } catch (refreshErr) {
            this.processQueue(refreshErr);
            clearAuth(ws);
            redirectToLoginIfNeeded();
            return Promise.reject(refreshErr);
          } finally {
            this.isRefreshing = false;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private processQueue(error: unknown) {
    this.failedQueue.forEach((p) => {
      if (error) p.reject(error);
      else p.resolve();
    });
    this.failedQueue = [];
  }

  private attachmentToContentPart(attachment: ChatAttachment): Record<string, unknown> {
    const isImage = attachment.mime.toLowerCase().startsWith("image/");
    if (isImage) {
      return { type: "image", image: attachment.url };
    }

    return {
      type: "file",
      file_url: attachment.url,
      filename: attachment.name,
      mime_type: attachment.mime,
    };
  }

  private normalizeStreamMessagePayload(data: MessageSendRequest): Omit<MessageSendRequest, "attachments"> {
    const attachments = Array.isArray(data.attachments) ? data.attachments : [];
    if (attachments.length === 0) {
      return { content: data.content };
    }

    const contentParts: Array<string | Record<string, unknown>> = [];

    if (Array.isArray(data.content)) {
      contentParts.push(...data.content);
    } else if (typeof data.content === "string") {
      if (data.content.length > 0) {
        contentParts.push({ type: "text", text: data.content });
      }
    } else if (data.content != null) {
      contentParts.push({ type: "text", text: this.extractText(data.content) });
    }

    contentParts.push(...attachments.map((attachment) => this.attachmentToContentPart(attachment)));

    return { content: contentParts };
  }

  private extractText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value == null) return "";

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") return item;
          if (!item || typeof item !== "object") return "";

          const text = (item as { text?: unknown }).text;
          if (typeof text === "string") return text;

          const content = (item as { content?: unknown }).content;
          if (typeof content === "string") return content;

          return "";
        })
        .filter(Boolean)
        .join("");
    }

    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const text = obj.text;
      if (typeof text === "string") return text;

      const content = obj.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) return this.extractText(content);
    }

    return "";
  }

  private extractStreamChunk(data: unknown): Omit<MessageStreamChunk, "event" | "raw"> | null {
    if (typeof data === "string") {
      if (!data.trim() || data.trim() === "[DONE]") return null;
      return { text: data, mode: "append" };
    }

    if (!data || typeof data !== "object") return null;

    const payload = data as Record<string, unknown>;

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    if (choices.length > 0 && choices[0] && typeof choices[0] === "object") {
      const first = choices[0] as Record<string, unknown>;
      const delta = first.delta;
      if (delta && typeof delta === "object") {
        const deltaText = this.extractText(delta);
        if (deltaText) return { text: deltaText, mode: "append" };
      }

      const choiceText = this.extractText(first.text);
      if (choiceText) return { text: choiceText, mode: "append" };
    }

    const delta = payload.delta;
    if (typeof delta === "string" && delta) return { text: delta, mode: "append" };
    if (delta && typeof delta === "object") {
      const deltaText = this.extractText(delta);
      if (deltaText) return { text: deltaText, mode: "append" };
    }

    const token = payload.token;
    if (typeof token === "string" && token) return { text: token, mode: "append" };

    const chunk = payload.chunk;
    if (typeof chunk === "string" && chunk) return { text: chunk, mode: "append" };

    const role = payload.role;
    if (role === "user") return null;

    const message = payload.message;
    if (message && typeof message === "object") {
      const msg = message as Record<string, unknown>;
      if (msg.role === "user") return null;
      const messageText = this.extractText(msg.content);
      if (messageText) return { text: messageText, mode: "replace" };
    }

    const assistantMessage = payload.assistant_message;
    if (assistantMessage && typeof assistantMessage === "object") {
      const messageText = this.extractText((assistantMessage as Record<string, unknown>).content);
      if (messageText) return { text: messageText, mode: "replace" };
    }

    const outputText = this.extractText(payload.output_text);
    if (outputText) return { text: outputText, mode: "replace" };

    const contentText = this.extractText(payload.content);
    if (contentText) return { text: contentText, mode: "append" };

    const text = this.extractText(payload.text);
    if (text) return { text, mode: "append" };

    return null;
  }

  private parseSSEData(data: string): unknown {
    const trimmed = data.trim();
    if (!trimmed || trimmed === "[DONE]") return null;

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return data;
    }
  }

  private getRuntimeBaseUrl(): string {
    return String(this.client.defaults.baseURL || requireWorkspaceUrl()).replace(/\/+$/, "");
  }

  private buildRuntimeFetchHeaders(baseHeaders: HeadersInit | undefined, accessToken: string | null): Headers {
    const headers = new Headers(baseHeaders);
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    const runtimeApiKey = getRuntimeApiKey();
    if (runtimeApiKey) {
      headers.set("X-API-Key", runtimeApiKey);
    }

    return headers;
  }

  private async runtimeFetchWithRefresh(url: string, init: RequestInit): Promise<Response> {
    const ws = getWorkspaceUrl();
    let accessToken = getAuthToken(ws);

    const doFetch = (token: string | null) =>
      fetch(url, {
        ...init,
        headers: this.buildRuntimeFetchHeaders(init.headers, token),
      });

    let response = await doFetch(accessToken);

    if (response.status === 401) {
      const refreshToken = getRefreshToken(ws);
      if (refreshToken) {
        try {
          const refreshed = await this.refreshToken(refreshToken);
          accessToken = refreshed.access_token;
          setAuthToken(ws, accessToken);
          response = await doFetch(accessToken);
        } catch (refreshErr) {
          clearAuth(ws);
          redirectToLoginIfNeeded();
          throw refreshErr;
        }
      } else {
        clearAuth(ws);
        redirectToLoginIfNeeded();
        throw new Error("Unauthorized");
      }
    }

    return response;
  }

  private isApprovalRequiredEvent(value: unknown): value is ApprovalRequiredEvent {
    if (!value || typeof value !== "object") return false;

    const event = value as Record<string, unknown>;
    return (
      event.type === "approval_required" &&
      typeof event.tool_call_id === "string" &&
      typeof event.function_namespace === "string" &&
      typeof event.function_name === "string" &&
      !!event.arguments &&
      typeof event.arguments === "object"
    );
  }

  private isToolStartEvent(value: unknown): value is ToolStartEvent {
    if (!value || typeof value !== "object") return false;

    const event = value as Record<string, unknown>;
    return (
      (event.type === undefined || event.type === "tool_start") &&
      typeof event.tool_call_id === "string" &&
      typeof event.name === "string"
    );
  }

  private isToolEndEvent(value: unknown): value is ToolEndEvent {
    if (!value || typeof value !== "object") return false;

    const event = value as Record<string, unknown>;
    return (
      typeof event.tool_call_id === "string" &&
      (event.type === undefined || event.type === "tool_end" || "result" in event)
    );
  }

  private handleChatStreamEvent(eventType: string, parsed: unknown, handlers: ChatStreamHandlers): boolean {
    if (eventType === "message") {
      if (typeof parsed === "string") {
        handlers.onChunkContent?.(parsed);
        return false;
      }

      if (parsed && typeof parsed === "object") {
        const payload = parsed as Record<string, unknown>;
        const contentText = this.extractText(payload.content);
        if (contentText) handlers.onChunkContent?.(contentText);

        if (this.isApprovalRequiredEvent(parsed)) handlers.onApprovalRequired?.(parsed);
        if (this.isToolStartEvent(parsed)) handlers.onToolStart?.(parsed);
        if (this.isToolEndEvent(parsed)) handlers.onToolEnd?.(parsed);
      }
      return false;
    }

    if (eventType === "tool_start") {
      if (this.isToolStartEvent(parsed)) handlers.onToolStart?.(parsed);
      return false;
    }

    if (eventType === "tool_end") {
      if (this.isToolEndEvent(parsed)) handlers.onToolEnd?.(parsed);
      return false;
    }

    if (eventType === "approval_required") {
      if (this.isApprovalRequiredEvent(parsed)) handlers.onApprovalRequired?.(parsed);
      return false;
    }

    if (eventType === "done") {
      handlers.onDone?.();
      return true;
    }

    if (eventType === "error") {
      if (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)) {
        handlers.onError?.((parsed as { error?: unknown }).error ?? parsed);
      } else {
        handlers.onError?.(parsed);
      }
      return true;
    }

    return false;
  }

  private async consumeChatSSEStream(body: ReadableStream<Uint8Array>, handlers: ChatStreamHandlers) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines: string[] = [];

    const flushEvent = (): boolean => {
      if (dataLines.length === 0) {
        currentEvent = "message";
        return false;
      }

      const rawData = dataLines.join("\n");
      dataLines = [];

      const parsed = this.parseSSEData(rawData);
      if (parsed == null) {
        currentEvent = "message";
        return false;
      }

      const shouldStop = this.handleChatStreamEvent(currentEvent, parsed, handlers);
      currentEvent = "message";
      return shouldStop;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const nlIndex = buffer.indexOf("\n");
          if (nlIndex === -1) break;

          let line = buffer.slice(0, nlIndex);
          buffer = buffer.slice(nlIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);

          if (!line) {
            if (flushEvent()) return;
            continue;
          }

          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim() || "message";
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }

      buffer += decoder.decode();
      if (buffer) {
        const lines = buffer.split(/\r?\n/);
        for (const line of lines) {
          if (!line) {
            if (flushEvent()) return;
            continue;
          }
          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim() || "message";
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }

      flushEvent();
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Ignore release errors during aborted streams.
      }
    }
  }

  private startChatSSEStream(url: string, init: RequestInit, handlers: ChatStreamHandlers): ChatStreamHandle {
    const controller = new AbortController();
    let aborted = false;

    const done = (async () => {
      try {
        const response = await this.runtimeFetchWithRefresh(url, {
          ...init,
          signal: controller.signal,
        });

        if (!response.ok) {
          let detail = "";
          try {
            detail = await response.text();
          } catch {
            detail = "";
          }
          handlers.onError?.(new Error(`HTTP error! status: ${response.status}${detail ? ` ${detail}` : ""}`));
          return;
        }

        if (!response.body) {
          handlers.onError?.(new Error("No stream body"));
          return;
        }

        await this.consumeChatSSEStream(response.body, handlers);
      } catch (error) {
        if (aborted) return;
        handlers.onError?.(error);
      }
    })();

    return {
      abort: () => {
        aborted = true;
        controller.abort();
      },
      done,
    };
  }

  private async consumeSSEStream(
    body: ReadableStream<Uint8Array>,
    onChunk?: (chunk: MessageStreamChunk) => void
  ) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines: string[] = [];

    const flushEvent = () => {
      if (dataLines.length === 0) {
        currentEvent = "message";
        return;
      }

      const rawData = dataLines.join("\n");
      dataLines = [];

      const parsed = this.parseSSEData(rawData);
      if (parsed == null) {
        currentEvent = "message";
        return;
      }

      const chunk = this.extractStreamChunk(parsed);
      if (chunk && onChunk) {
        onChunk({ ...chunk, event: currentEvent, raw: parsed });
      }

      currentEvent = "message";
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const nlIndex = buffer.indexOf("\n");
        if (nlIndex === -1) break;

        let line = buffer.slice(0, nlIndex);
        buffer = buffer.slice(nlIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);

        if (!line) {
          flushEvent();
          continue;
        }

        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim() || "message";
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      const lines = buffer.split(/\r?\n/);
      for (const line of lines) {
        if (!line) {
          flushEvent();
          continue;
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim() || "message";
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    flushEvent();
  }

  private async streamMessageRequest(
    chatId: string,
    data: MessageSendRequest,
    accessToken: string | null,
    signal?: AbortSignal
  ) {
    const base = String(this.client.defaults.baseURL || requireWorkspaceUrl()).replace(/\/+$/, "");
    const encodedChatId = encodeURIComponent(chatId);
    const url = `${base}/chats/${encodedChatId}/messages/stream`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const runtimeApiKey = getRuntimeApiKey();
    if (runtimeApiKey) headers["X-API-Key"] = runtimeApiKey;

    const payload = this.normalizeStreamMessagePayload(data);

    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  }

  // --------------------
  // Auth
  // --------------------
  async login(data: LoginRequest): Promise<LoginResponse> {
    const res = await this.client.post("/auth/login", data);
    return res.data as LoginResponse;
  }

  async verifyOTP(data: OTPVerifyRequest): Promise<OTPVerifyResponse> {
    const res = await this.client.post("/auth/verify-otp", data);
    return res.data as OTPVerifyResponse;
  }

  async me(): Promise<User> {
    const res = await this.client.get("/auth/me");
    return res.data as User;
  }

  async refreshToken(refreshToken: string): Promise<RefreshResponse> {
    const res = await this.client.post("/auth/refresh", { refresh_token: refreshToken });
    return res.data as RefreshResponse;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.client.post("/auth/logout", { refresh_token: refreshToken });
  }

  // --------------------
  // Chats
  // --------------------
  async listChats(): Promise<Chat[]> {
    const res = await this.client.get("/chats");
    return res.data as Chat[];
  }

  async getChat(chatId: string): Promise<ChatWithMessages> {
    const res = await this.client.get(`/chats/${chatId}`);
    return res.data as ChatWithMessages;
  }

  async updateChat(chatId: string, data: Pick<Chat, "title">): Promise<Chat> {
    const res = await this.client.put(`/chats/${chatId}`, data);
    return res.data as Chat;
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.client.delete(`/chats/${chatId}`);
  }

  async createChatWithAgent(namespace: string, name: string, data: ChatCreate): Promise<Chat> {
    const encodedNamespace = encodeURIComponent(namespace);
    const encodedName = encodeURIComponent(name);
    const res = await this.client.post(`/agents/${encodedNamespace}/${encodedName}/chats`, data);
    return res.data as Chat;
  }

  async sendMessage(chatId: string, data: MessageSendRequest): Promise<Message> {
    const res = await this.client.post(`/chats/${chatId}/messages`, data);
    return res.data as Message;
  }

  streamChatMessage(
    chatId: string,
    content: MessageSendRequest["content"],
    handlers: ChatStreamHandlers = {}
  ): ChatStreamHandle {
    const encodedChatId = encodeURIComponent(chatId);
    const url = `${this.getRuntimeBaseUrl()}/chats/${encodedChatId}/messages/stream`;
    const payload = this.normalizeStreamMessagePayload({ content });

    return this.startChatSSEStream(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      handlers
    );
  }

  async approveToolCall(chatId: string, toolCallId: string, approved: boolean): Promise<string> {
    const encodedChatId = encodeURIComponent(chatId);
    const encodedToolCallId = encodeURIComponent(toolCallId);
    const payload: ToolApprovalRequest = { approved };

    const res = await this.client.post(
      `/chats/${encodedChatId}/approve-tool/${encodedToolCallId}`,
      payload
    );

    const data = res.data as ToolApprovalResponse;
    if (!data.channel_id) {
      throw new Error("Approval response missing channel_id");
    }

    return data.channel_id;
  }

  streamChatChannel(chatId: string, channelId: string, handlers: ChatStreamHandlers = {}): ChatStreamHandle {
    const encodedChatId = encodeURIComponent(chatId);
    const encodedChannelId = encodeURIComponent(channelId);
    const url = `${this.getRuntimeBaseUrl()}/chats/${encodedChatId}/stream/${encodedChannelId}`;

    return this.startChatSSEStream(
      url,
      {
        method: "GET",
      },
      handlers
    );
  }

  streamApprovalChannel(chatId: string, channelId: string, handlers: ChatStreamHandlers = {}): ChatStreamHandle {
    return this.streamChatChannel(chatId, channelId, handlers);
  }

  async sendMessageStream(chatId: string, data: MessageSendRequest, options: SendMessageStreamOptions = {}) {
    const ws = getWorkspaceUrl();
    let accessToken = getAuthToken(ws);

    let response = await this.streamMessageRequest(chatId, data, accessToken, options.signal);

    if (response.status === 401) {
      const refreshToken = getRefreshToken(ws);
      if (refreshToken) {
        try {
          const refreshed = await this.refreshToken(refreshToken);
          accessToken = refreshed.access_token;
          setAuthToken(ws, accessToken);
          response = await this.streamMessageRequest(chatId, data, accessToken, options.signal);
        } catch (refreshErr) {
          clearAuth(ws);
          redirectToLoginIfNeeded();
          throw refreshErr;
        }
      } else {
        clearAuth(ws);
        redirectToLoginIfNeeded();
        throw new Error("Unauthorized");
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        clearAuth(ws);
        redirectToLoginIfNeeded();
      }

      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
      throw new Error(`Stream request failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    if (!response.body) return;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const text = await response.text();
      const parsed = this.parseSSEData(text);
      if (parsed == null || !options.onChunk) return;
      const chunk = this.extractStreamChunk(parsed);
      if (chunk) options.onChunk({ ...chunk, event: "message", raw: parsed });
      return;
    }

    await this.consumeSSEStream(response.body, options.onChunk);
  }

  async listMessages(chatId: string): Promise<Message[]> {
    const res = await this.client.get(`/chats/${chatId}/messages`);
    return res.data as Message[];
  }

  // --------------------
  // Preference states
  // --------------------
  async listPreferenceStates<TValue = unknown>(): Promise<Array<PreferenceStateRecord<TValue>>> {
    const res = await this.client.get("/stores/default/preferences/states");
    return res.data as Array<PreferenceStateRecord<TValue>>;
  }

  async createPreferenceState<TValue = unknown>(
    payload: CreatePreferenceStateRequest<TValue>
  ): Promise<PreferenceStateRecord<TValue>> {
    const res = await this.client.post("/stores/default/preferences/states", payload);
    return res.data as PreferenceStateRecord<TValue>;
  }

  async updatePreferenceState<TValue = unknown>(
    key: string,
    payload: UpdatePreferenceStateRequest<TValue>
  ): Promise<PreferenceStateRecord<TValue>> {
    const encodedKey = encodeURIComponent(key);
    const res = await this.client.put(`/stores/default/preferences/states/${encodedKey}`, payload);
    return res.data as PreferenceStateRecord<TValue>;
  }

  async deletePreferenceState(key: string): Promise<void> {
    const encodedKey = encodeURIComponent(key);
    await this.client.delete(`/stores/default/preferences/states/${encodedKey}`);
  }

  // --------------------
  // Files
  // --------------------
  async uploadFile(namespace: string, collection: string, data: FileUpload): Promise<FileResponse> {
    const encodedNamespace = encodeURIComponent(namespace);
    const encodedCollection = encodeURIComponent(collection);
    const res = await this.client.post(`/files/${encodedNamespace}/${encodedCollection}`, data);
    return res.data as FileResponse;
  }

  async generateFileTempUrl(
    namespace: string,
    collection: string,
    filename: string,
    options: { expiresIn?: number; version?: number } = {}
  ): Promise<TempUrlResponse | string> {
    const encodedNamespace = encodeURIComponent(namespace);
    const encodedCollection = encodeURIComponent(collection);
    const encodedFilename = encodeURIComponent(filename);
    const params: Record<string, number> = {
      expires_in: options.expiresIn ?? 3600,
    };
    if (typeof options.version === "number") {
      params.version = options.version;
    }

    const res = await this.client.post(
      `/files/${encodedNamespace}/${encodedCollection}/${encodedFilename}/url`,
      null,
      { params }
    );
    return res.data as TempUrlResponse | string;
  }

  // --------------------
  // Agents (config)
  // --------------------
  async listAgents(appId?: string): Promise<AgentResponse[]> {
    const normalizedAppId = appId?.trim();
    const res = await this.client.get("/api/v1/agents", {
      headers: normalizedAppId ? { "X-Application": normalizedAppId } : undefined,
    });
    return res.data as AgentResponse[];
  }

  async getAgent(namespace: string, name: string, appId?: string): Promise<AgentResponse> {
    const encodedNamespace = encodeURIComponent(namespace);
    const encodedName = encodeURIComponent(name);
    const normalizedAppId = appId?.trim();

    const res = await this.client.get(`/api/v1/agents/${encodedNamespace}/${encodedName}`, {
      headers: normalizedAppId ? { "X-Application": normalizedAppId } : undefined,
    });

    return res.data as AgentResponse;
  }
}

export const apiClient = new APIClient();
