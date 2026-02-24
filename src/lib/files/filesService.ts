import { isAxiosError } from "axios";

import { apiClient } from "../api";
import { getFilesConfig } from "./config";
import type { ChatAttachment, FileUpload, TempUrlResponse } from "./types";

const DEFAULT_TEMP_URL_EXPIRES_IN = 3600;
const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

export type UploadChatAttachmentErrorCode = "file_too_large" | "no_permission" | "not_configured";

export class UploadChatAttachmentError extends Error {
  readonly code: UploadChatAttachmentErrorCode;

  constructor(code: UploadChatAttachmentErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "UploadChatAttachmentError";
  }
}

function extractTempUrl(response: TempUrlResponse | string): string {
  if (typeof response === "string") {
    const trimmed = response.trim();
    if (trimmed) return trimmed;
  }

  if (!response || typeof response !== "object") {
    throw new UploadChatAttachmentError("not_configured", "Invalid temp URL response");
  }

  const maybeUrl = response.url ?? response.signed_url ?? response.data_url;
  if (typeof maybeUrl === "string" && maybeUrl.trim()) {
    return maybeUrl.trim();
  }

  throw new UploadChatAttachmentError("not_configured", "Missing temp URL");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new UploadChatAttachmentError("not_configured", "Could not read file data"));
    };

    reader.onerror = () => {
      reject(new UploadChatAttachmentError("not_configured", "Could not read file"));
    };

    reader.readAsDataURL(file);
  });
}

function extractBase64(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1 || commaIndex === dataUrl.length - 1) {
    throw new UploadChatAttachmentError("not_configured", "Invalid data URL payload");
  }

  return dataUrl.slice(commaIndex + 1);
}

function toSafeFilenamePart(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "file";
}

function buildStoredFilename(chatId: string, originalName: string): string {
  const safeChatId = toSafeFilenamePart(chatId);
  const safeOriginalName = toSafeFilenamePart(originalName);
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `chat-${safeChatId}-${uniquePart}-${safeOriginalName}`;
}

function toUploadError(error: unknown): UploadChatAttachmentError {
  if (error instanceof UploadChatAttachmentError) {
    return error;
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return new UploadChatAttachmentError("no_permission", "No permission to upload files");
    }
  }

  return new UploadChatAttachmentError(
    "not_configured",
    "File uploads aren’t configured on this Sinas instance. Ask admin to configure it."
  );
}

export async function generateTempUrl(filename: string, version?: number, expiresIn = DEFAULT_TEMP_URL_EXPIRES_IN) {
  const { namespace, collection } = getFilesConfig();

  try {
    const response = await apiClient.generateFileTempUrl(namespace, collection, filename, {
      expiresIn,
      version,
    });

    return extractTempUrl(response);
  } catch (error) {
    throw toUploadError(error);
  }
}

export async function uploadChatAttachment(file: File, chatId: string): Promise<ChatAttachment> {
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new UploadChatAttachmentError("file_too_large", "File is too large. Max size is 20 MB.");
  }

  try {
    const originalName = file.name;
    const storedName = buildStoredFilename(chatId, originalName);
    const dataUrl = await readFileAsDataUrl(file);
    const contentBase64 = extractBase64(dataUrl);
    const payload: FileUpload = {
      name: storedName,
      content_base64: contentBase64,
      content_type: file.type || "application/octet-stream",
      visibility: "private",
      file_metadata: {
        chat_id: chatId,
        original_name: originalName,
      },
    };

    const { namespace, collection } = getFilesConfig();
    const uploadResponse = await apiClient.uploadFile(namespace, collection, payload);
    const version = typeof uploadResponse.version === "number" ? uploadResponse.version : undefined;

    const tempUrl = await generateTempUrl(storedName, version, DEFAULT_TEMP_URL_EXPIRES_IN);

    return {
      name: originalName,
      mime: file.type || "application/octet-stream",
      size: file.size,
      url: tempUrl,
      uploaded_at: new Date().toISOString(),
    };
  } catch (error) {
    throw toUploadError(error);
  }
}
