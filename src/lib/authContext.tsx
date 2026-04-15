import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { apiClient } from "./api";
import { getWorkspaceUrl, WORKSPACE_QUERY_CHANGE_EVENT } from "./workspace";
import {
  clearAuth,
  clearLegacyGlobalAuthKeys,
  getAuthToken,
  getRefreshToken,
  getStoredUser,
  setAuthToken,
  setRefreshToken,
  setStoredUser,
} from "./authStorage";
import type { User } from "../types";

type AuthContextType = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string) => Promise<string>;
  verifyOTP: (sessionId: string, otpCode: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeWorkspaceUrl, setActiveWorkspaceUrl] = useState(() => getWorkspaceUrl());

  const refreshTimerRef = useRef<number | null>(null);
  const bootstrapRunRef = useRef(0);

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const startRefreshTimer = (workspaceUrl: string) => {
    clearRefreshTimer();

    refreshTimerRef.current = window.setInterval(async () => {
      const refreshToken = getRefreshToken(workspaceUrl);

      if (!refreshToken) return;

      try {
        const resp = await apiClient.refreshToken(refreshToken);
        setAuthToken(workspaceUrl, resp.access_token);
        if (getWorkspaceUrl() === workspaceUrl) {
          setTokenState(resp.access_token);
        }
      } catch {
        // if refresh fails, we just stop trying; next API call will 401 and redirect
        clearRefreshTimer();
      }
    }, 14 * 60 * 1000); // your access token is 900s (15m) so refresh at 14m is good
  };

  useEffect(() => {
    const syncWorkspace = () => {
      const nextWorkspaceUrl = getWorkspaceUrl();
      setActiveWorkspaceUrl((current) => (current === nextWorkspaceUrl ? current : nextWorkspaceUrl));
    };

    syncWorkspace();
    window.addEventListener("popstate", syncWorkspace);
    window.addEventListener(WORKSPACE_QUERY_CHANGE_EVENT, syncWorkspace);

    return () => {
      window.removeEventListener("popstate", syncWorkspace);
      window.removeEventListener(WORKSPACE_QUERY_CHANGE_EVENT, syncWorkspace);
    };
  }, []);

  useEffect(() => {
    const ws = activeWorkspaceUrl;
    const runId = ++bootstrapRunRef.current;

    clearLegacyGlobalAuthKeys();
    clearRefreshTimer();
    apiClient.setWorkspaceBaseUrl(ws || undefined);
    setLoading(true);

    const storedToken = ws ? getAuthToken(ws) : null;
    const storedUserJson = ws ? getStoredUser(ws) : null;

    setTokenState(storedToken);

    if (storedUserJson) {
      try {
        setUser(JSON.parse(storedUserJson) as User);
      } catch {
        setUser(null);
      }
    } else {
      setUser(null);
    }

    if (!storedToken || !ws) {
      setLoading(false);
      return;
    }

    apiClient
      .me()
      .then((me) => {
        if (bootstrapRunRef.current !== runId) return;
        setUser(me);
        setStoredUser(ws, JSON.stringify(me));
        startRefreshTimer(ws);
      })
      .catch(() => {
        if (bootstrapRunRef.current !== runId) return;
        clearAuth(ws);
        setTokenState(null);
        setUser(null);
      })
      .finally(() => {
        if (bootstrapRunRef.current !== runId) return;
        setLoading(false);
      });

    return () => {
      if (bootstrapRunRef.current === runId) {
        clearRefreshTimer();
      }
    };
  }, [activeWorkspaceUrl]);

  useEffect(() => {
    return () => clearRefreshTimer();
  }, []);

  const login = async (email: string) => {
    const resp = await apiClient.login({ email });
    return resp.session_id;
  };

  const verifyOTP = async (sessionId: string, otpCode: string) => {
    const ws = getWorkspaceUrl();
    const resp = await apiClient.verifyOTP({ session_id: sessionId, otp_code: otpCode });

    clearLegacyGlobalAuthKeys();
    setAuthToken(ws, resp.access_token);
    setRefreshToken(ws, resp.refresh_token);
    setStoredUser(ws, JSON.stringify(resp.user));

    setTokenState(resp.access_token);
    setUser(resp.user);

    startRefreshTimer(ws);
  };

  const logout = async () => {
    const ws = getWorkspaceUrl();
    const refreshToken = getRefreshToken(ws);

    if (refreshToken) {
      try {
        await apiClient.logout(refreshToken);
      } catch {
        // ignore
      }
    }

    clearLegacyGlobalAuthKeys();
    clearAuth(ws);
    setTokenState(null);
    setUser(null);
    clearRefreshTimer();
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, verifyOTP, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
