import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../lib/authContext.tsx";
import { getWorkspaceUrl, setWorkspaceUrl } from "../../lib/workspace";
import { apiClient } from "../../lib/api";
import { useTheme } from "../../lib/useTheme";
import { emailSchema, otpSchema } from "../../lib/validation";
import RightArrowIcon from "../../icons/right-arrow.svg?react";
import sinasLogoLightFilled from "../../icons/sinas-logo-light-filled.svg";
import sinasLogoDarkFilled from "../../icons/sinas-logo-dark-filled.svg";
import { Input } from "../../components/Input/Input.tsx";
import { Button } from "../../components/Button/Button.tsx";
import SinasLoader from "../../components/Loader/Loader.tsx";
import { ThemeSwitch } from "../../components/ThemeSwitch/ThemeSwitch.tsx";

import { OTPInput } from "../OTPInput/OTPInput.tsx";
import { WorkspaceModal } from "./WorkspaceModal/WorkspaceModal.tsx";

import styles from "./LoginPage.module.scss";

type Step = "email" | "otp";

function prettyHost(url: string) {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login, verifyOTP } = useAuth();
  const { theme } = useTheme();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sessionId, setSessionId] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");

  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const lastAutoSubmittedOtp = useRef<string | null>(null);
  const isEmailActionLoading = loading;

  // refresh label after save by depending on modal open state
  const workspaceUrl = useMemo(() => getWorkspaceUrl(), [workspaceModalOpen]);
  const workspaceLabel = useMemo(() => prettyHost(workspaceUrl), [workspaceUrl]);
  const logoSrc = theme === "dark" ? sinasLogoLightFilled : sinasLogoDarkFilled;

  useEffect(() => {
    apiClient.setWorkspaceBaseUrl(workspaceUrl);
  }, [workspaceUrl]);

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmailActionLoading) return;
    setError("");
    const parsedEmail = emailSchema.safeParse(email);

    if (!parsedEmail.success) {
      setEmailError(parsedEmail.error.issues[0]?.message ?? "Please enter a valid email.");
      return;
    }

    setEmailError("");
    setLoading(true);

    try {
      const sid = await login(parsedEmail.data);
      setSessionId(sid);
      setStep("otp");
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtpCode = useCallback(async (otpCode: string) => {
    setError("");
    const parsedOtp = otpSchema.safeParse(otpCode);

    if (!parsedOtp.success) {
      setError(parsedOtp.error.issues[0]?.message ?? "Enter a valid 6-digit code.");
      return;
    }

    setLoading(true);

    try {
      await verifyOTP(sessionId, parsedOtp.data);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || "Invalid OTP code");
    } finally {
      setLoading(false);
    }
  }, [navigate, sessionId, verifyOTP]);

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    await verifyOtpCode(otp);
  };

  useEffect(() => {
    if (step !== "otp" || !sessionId || loading) return;

    const cleanOtp = otp.replace(/\D/g, "").slice(0, 6);
    if (cleanOtp.length !== 6) {
      lastAutoSubmittedOtp.current = null;
      return;
    }

    if (lastAutoSubmittedOtp.current === cleanOtp) return;
    lastAutoSubmittedOtp.current = cleanOtp;

    void verifyOtpCode(cleanOtp);
  }, [loading, otp, sessionId, step, verifyOtpCode]);

  const onWorkspaceSave = (url: string) => {
    setWorkspaceUrl(url);
    apiClient.setWorkspaceBaseUrl(url);

    // reset login state
    setError("");
    setStep("email");
    setSessionId("");
    setOtp("");

    setWorkspaceModalOpen(false);
  };

  return (
    <div className={styles.login}>
      <ThemeSwitch />

      <div className={styles.card}>
        <div className={styles.header}>
          <img className={styles.logo} src={logoSrc} alt="Sinas" />
        </div>

        {step === "email" ? (
          <>
            <form onSubmit={submitEmail} className={styles.form} noValidate>
              <div className={styles.field}>
                <label htmlFor="login-email" className={styles.fieldLabel}>
                  Email
                </label>
                <Input
                  id="login-email"
                  type="email"
                  value={email}
                  wrapperClassName={styles.emailInputWrapper}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError("");
                    if (error) setError("");
                  }}
                  placeholder="you@company.com"
                  autoComplete="email"
                  disabled={loading}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? "login-email-error" : undefined}
                  endAction={
                    <Button
                      type="submit"
                      variant="minimal"
                      className={`${styles.inputAction} ${isEmailActionLoading ? styles.inputActionLoading : ""}`}
                      disabled={!email.trim()}
                      aria-disabled={isEmailActionLoading}
                      aria-label="Send one-time code"
                    >
                      {isEmailActionLoading ? (
                        <SinasLoader size={32} />
                      ) : (
                        <RightArrowIcon className={styles.inputActionIcon} aria-hidden="true" />
                      )}
                    </Button>
                  }
                />
                {emailError && (
                  <div id="login-email-error" className={styles.fieldError}>
                    {emailError}
                  </div>
                )}
              </div>

              <div className={styles.hint}>We’ll send a one-time code to your email.</div>

              <div className={styles.workspaceRow}>
                <div className={styles.workspaceLabel}>
                  Connected to: <span className={styles.mono}>{workspaceLabel}</span>
                </div>
                <Button
                  type="button"
                  variant="link"
                  onClick={() => setWorkspaceModalOpen(true)}
                  disabled={loading}
                >
                  Switch workspace
                </Button>
              </div>

              {error && <div className={styles.error}>{error}</div>}
            </form>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Insert your one-time code</h1>

            <div className={styles.subTitle}>
              Code sent to {email}
            </div>

            <form onSubmit={submitOtp} className={styles.form} noValidate>
              <OTPInput value={otp} onChange={setOtp} disabled={loading} />
              {loading ? (
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <SinasLoader size={28} />
                  <span className={styles.loadingText}>Verifying code...</span>
                </div>
              ) : null}

              {error && <div className={styles.error}>{error}</div>}

              <div className={styles.actions}>
                <Button
                  type="button"
                  variant="link"
                  onClick={() => {
                    setStep("email");
                    setOtp("");
                    setError("");
                  }}
                  disabled={loading}
                >
                  Use a different email
                </Button>
              </div>
            </form>
          </>
        )}

        <div className={`${styles.footer} ${step === "otp" ? styles.footerOtp : ""}`}>
          Secure authentication powered by Sinas
        </div>
      </div>

      <WorkspaceModal
        open={workspaceModalOpen}
        initialValue={workspaceUrl}
        onClose={() => setWorkspaceModalOpen(false)}
        onSave={onWorkspaceSave}
      />
    </div>
  );
}
