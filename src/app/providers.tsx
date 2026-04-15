import React, { useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../lib/authContext.tsx";
import { ThemeProvider } from "../lib/themeContext.tsx";
import { getWorkspaceUrl, WORKSPACE_QUERY_CHANGE_EVENT } from "../lib/workspace.ts";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function normalizeWorkspaceIdentity(workspaceUrl: string): string {
  return workspaceUrl.trim().replace(/\/+$/, "");
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const previousWorkspaceRef = useRef<string>(getWorkspaceUrl());

  useEffect(() => {
    const onWorkspaceMaybeChanged = () => {
      const previousWorkspace = normalizeWorkspaceIdentity(previousWorkspaceRef.current);
      const currentWorkspace = normalizeWorkspaceIdentity(getWorkspaceUrl());
      if (previousWorkspace === currentWorkspace) return;

      previousWorkspaceRef.current = currentWorkspace;

      void queryClient.cancelQueries({
        predicate: (query) => query.queryKey.some((part) => part === previousWorkspace),
      });
      queryClient.removeQueries({
        predicate: (query) => query.queryKey.some((part) => part === previousWorkspace),
      });
    };

    window.addEventListener(WORKSPACE_QUERY_CHANGE_EVENT, onWorkspaceMaybeChanged);
    window.addEventListener("popstate", onWorkspaceMaybeChanged);

    return () => {
      window.removeEventListener(WORKSPACE_QUERY_CHANGE_EVENT, onWorkspaceMaybeChanged);
      window.removeEventListener("popstate", onWorkspaceMaybeChanged);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
