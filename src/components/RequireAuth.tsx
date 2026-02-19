import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/authContext.tsx";
import SinasLoader from "./Loader/Loader.tsx";
import styles from "./RequireAuth.module.scss";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, user, token } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className={styles.loadingState} role="status" aria-live="polite">
        <SinasLoader size={32} />
        <span className={styles.loadingText}>Checking your session...</span>
      </div>
    );
  }

  // If either is missing, treat as logged out
  if (!user || !token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
