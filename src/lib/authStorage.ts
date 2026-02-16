const workspaceKey = (workspaceUrl: string) => {
  const normalized = workspaceUrl.replace(/\/+$/, "");
  return normalized;
};

export const getAuthToken = (workspaceUrl: string): string | null => {
  return localStorage.getItem(`authToken:${workspaceKey(workspaceUrl)}`);
};

export const setAuthToken = (workspaceUrl: string, token: string) => {
  localStorage.setItem(`authToken:${workspaceKey(workspaceUrl)}`, token);
};

export const clearAuthToken = (workspaceUrl: string) => {
  localStorage.removeItem(`authToken:${workspaceKey(workspaceUrl)}`);
};

export const getRefreshToken = (workspaceUrl: string): string | null => {
  return localStorage.getItem(`refreshToken:${workspaceKey(workspaceUrl)}`);
};

export const setRefreshToken = (workspaceUrl: string, token: string) => {
  localStorage.setItem(`refreshToken:${workspaceKey(workspaceUrl)}`, token);
};

export const clearRefreshToken = (workspaceUrl: string) => {
  localStorage.removeItem(`refreshToken:${workspaceKey(workspaceUrl)}`);
};

export const getStoredUser = (workspaceUrl: string): string | null => {
  return localStorage.getItem(`user:${workspaceKey(workspaceUrl)}`);
};

export const setStoredUser = (workspaceUrl: string, userJson: string) => {
  localStorage.setItem(`user:${workspaceKey(workspaceUrl)}`, userJson);
};

export const clearStoredUser = (workspaceUrl: string) => {
  localStorage.removeItem(`user:${workspaceKey(workspaceUrl)}`);
};

export const clearAuth = (workspaceUrl: string) => {
    clearAuthToken(workspaceUrl);
    clearRefreshToken(workspaceUrl);
    clearStoredUser(workspaceUrl);
  };
  
