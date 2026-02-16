import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("Please enter a valid email address.");

export const otpSchema = z.string().regex(/^\d{6}$/, "Enter a valid 6-digit code.");

export function normalizeWorkspaceUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`.replace(/\/+$/, "");
  return trimmed.replace(/\/+$/, "");
}

const httpUrlSchema = z
  .string()
  .url("Please enter a valid URL.")
  .refine((value) => {
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Please enter a valid http(s) URL.");

export const workspaceUrlSchema = z
  .string()
  .trim()
  .min(1, "Workspace URL is required.")
  .transform((value) => normalizeWorkspaceUrl(value))
  .pipe(httpUrlSchema);
