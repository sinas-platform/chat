import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router.tsx";
import { AppProviders } from "./app/providers.tsx";
import { ensureWorkspaceQueryParamFromResolvedWorkspace } from "./lib/workspace.ts";

import "./styles/global.scss";

ensureWorkspaceQueryParamFromResolvedWorkspace();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>
);
