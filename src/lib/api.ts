import axios, { type AxiosError, type AxiosInstance } from "axios";
import { getWorkspaceUrl } from "./workspace";
import { clearAuth, getAuthToken, getRefreshToken, setAuthToken } from "./authStorage";

import type {
  Agent,
  Chat,
  ChatCreate,
  ChatWithMessages,
  LoginRequest,
  LoginResponse,
  Message,
  MessageSendRequest,
  OTPVerifyRequest,
  OTPVerifyResponse,
  User,
} from "../types";

type RefreshResponse = { access_token: string; expires_in: number };
type StreamChunkMode = "append" | "replace";

export type MessageStreamChunk = {
  text: string;
  mode: StreamChunkMode;
  event: string;
  raw: unknown;
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
      baseURL: getWorkspaceUrl(),
      headers: { "Content-Type": "application/json" },
    });

    this.setupInterceptors();
  }

  setWorkspaceBaseUrl(baseUrl: string) {
    this.client.defaults.baseURL = baseUrl.replace(/\/+$/, "");
  }

  private setupInterceptors() {
    this.client.interceptors.request.use((config) => {
      const ws = getWorkspaceUrl();
      const token = getAuthToken(ws);

      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
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
            window.location.href = "/login";
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
            window.location.href = "/login";
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

  private extractStreamChunk(data: unknown, _eventName: string): Omit<MessageStreamChunk, "event" | "raw"> | null {
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

      const chunk = this.extractStreamChunk(parsed, currentEvent);
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
    const base = (this.client.defaults.baseURL || getWorkspaceUrl()).replace(/\/+$/, "");
    const encodedChatId = encodeURIComponent(chatId);
    const url = `${base}/chats/${encodedChatId}/messages/stream`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
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
          window.location.href = "/login";
          throw refreshErr;
        }
      } else {
        clearAuth(ws);
        window.location.href = "/login";
        throw new Error("Unauthorized");
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        clearAuth(ws);
        window.location.href = "/login";
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
      const chunk = this.extractStreamChunk(parsed, "message");
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
  // Agents (runtime)
  // --------------------
  async listAgents(): Promise<Agent[]> {
    const res = await this.client.get("/agents");
    return res.data as Agent[];
  }
}

export const apiClient = new APIClient();
