export type FileVisibility = "private" | "public";

export interface FileUpload {
  name: string;
  content_base64: string;
  content_type: string;
  visibility: FileVisibility;
  file_metadata: Record<string, unknown>;
}

export interface FileResponse {
  filename?: string;
  version?: number;
  [key: string]: unknown;
}

export interface TempUrlResponse {
  url?: string;
  signed_url?: string;
  data_url?: string;
  [key: string]: unknown;
}

export interface ChatAttachment {
  name: string;
  mime: string;
  size: number;
  url: string;
  uploaded_at: string;
}
