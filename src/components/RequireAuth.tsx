import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/authContext.tsx";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, user, token } = useAuth();
  const location = useLocation();

  if (loading) return null; // TODO: add loader later

  // If either is missing, treat as logged out
  if (!user || !token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
