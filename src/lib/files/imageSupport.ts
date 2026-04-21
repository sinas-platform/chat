const UNSUPPORTED_BROWSER_IMAGE_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const UNSUPPORTED_BROWSER_IMAGE_EXTENSIONS = new Set(["heic", "heif", "hif"]);

function normalizeMimeType(value: string | null | undefined): string {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

function getFileExtension(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";

  let pathnameCandidate = trimmed;
  try {
    pathnameCandidate = new URL(trimmed).pathname;
  } catch {
    pathnameCandidate = trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
  }

  const filename = pathnameCandidate.split("/").filter(Boolean).pop() ?? pathnameCandidate;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filename.length - 1) return "";
  return filename.slice(dotIndex + 1).toLowerCase();
}

export function isImageMimeType(mimeType: string | null | undefined): boolean {
  const normalizedMime = normalizeMimeType(mimeType);
  return normalizedMime.startsWith("image/");
}

export function isUnsupportedBrowserImageMimeType(mimeType: string | null | undefined): boolean {
  const normalizedMime = normalizeMimeType(mimeType);
  return UNSUPPORTED_BROWSER_IMAGE_MIME_TYPES.has(normalizedMime);
}

export function hasUnsupportedBrowserImageExtension(value: string | null | undefined): boolean {
  const extension = getFileExtension(value);
  return extension.length > 0 && UNSUPPORTED_BROWSER_IMAGE_EXTENSIONS.has(extension);
}

export function isBrowserRenderableImage(params: {
  mimeType: string | null | undefined;
  name?: string | null;
  url?: string | null;
}): boolean {
  if (!isImageMimeType(params.mimeType)) return false;
  if (isUnsupportedBrowserImageMimeType(params.mimeType)) return false;
  if (hasUnsupportedBrowserImageExtension(params.name)) return false;
  if (hasUnsupportedBrowserImageExtension(params.url)) return false;
  return true;
}
