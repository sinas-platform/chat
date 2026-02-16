import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { apiClient } from "./api";
import { getWorkspaceUrl } from "./workspace";
import {
  clearAuth,
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

  const refreshTimerRef = useRef<number | null>(null);

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const startRefreshTimer = () => {
    clearRefreshTimer();

    refreshTimerRef.current = window.setInterval(async () => {
      const ws = getWorkspaceUrl();
      const refreshToken = getRefreshToken(ws);

      if (!refreshToken) return;

      try {
        const resp = await apiClient.refreshToken(refreshToken);
        setAuthToken(ws, resp.access_token);
        setTokenState(resp.access_token);
      } catch {
        // if refresh fails, we just stop trying; next API call will 401 and redirect
        clearRefreshTimer();
      }
    }, 14 * 60 * 1000); // your access token is 900s (15m) so refresh at 14m is good
  };

  useEffect(() => {
    const ws = getWorkspaceUrl();

    const storedToken = getAuthToken(ws);
    const storedUserJson = getStoredUser(ws);

    if (storedToken) setTokenState(storedToken);
    if (storedUserJson) {
      try {
        setUser(JSON.parse(storedUserJson) as User);
      } catch {
        // ignore
      }
    }

    // verify the token if we have it (optional but nice)
    if (storedToken) {
      apiClient
        .me()
        .then((me) => {
          setUser(me);
          setStoredUser(ws, JSON.stringify(me));
          startRefreshTimer();
        })
        .catch(() => {
          clearAuth(ws);
          setTokenState(null);
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

    return () => clearRefreshTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string) => {
    const resp = await apiClient.login({ email });
    return resp.session_id;
  };

  const verifyOTP = async (sessionId: string, otpCode: string) => {
    const ws = getWorkspaceUrl();
    const resp = await apiClient.verifyOTP({ session_id: sessionId, otp_code: otpCode });

    setAuthToken(ws, resp.access_token);
    setRefreshToken(ws, resp.refresh_token);
    setStoredUser(ws, JSON.stringify(resp.user));

    setTokenState(resp.access_token);
    setUser(resp.user);

    startRefreshTimer();
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
