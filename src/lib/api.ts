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
    const res = await this.client.post(`/agents/${namespace}/${name}/chats`, data);
    return res.data as Chat;
  }

  async sendMessage(chatId: string, data: MessageSendRequest): Promise<Message> {
    const res = await this.client.post(`/chats/${chatId}/messages`, data);
    return res.data as Message;
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
