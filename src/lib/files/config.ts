const DEFAULT_FILES_NAMESPACE = "sinas-ai";
const DEFAULT_FILES_COLLECTION = "chat-uploads";

export type FilesConfig = {
  namespace: string;
  collection: string;
};

export function getFilesConfig(): FilesConfig {
  const namespace = (import.meta.env.VITE_FILES_NAMESPACE as string | undefined)?.trim();
  const collection = (import.meta.env.VITE_FILES_COLLECTION as string | undefined)?.trim();

  return {
    namespace: namespace || DEFAULT_FILES_NAMESPACE,
    collection: collection || DEFAULT_FILES_COLLECTION,
  };
}
