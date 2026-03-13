import { env } from "../env";

const DEFAULT_FILES_NAMESPACE = "sinas-ai";
const DEFAULT_FILES_COLLECTION = "chat-uploads";

export type FilesConfig = {
  namespace: string;
  collection: string;
};

export function getFilesConfig(): FilesConfig {
  const namespace = env("VITE_FILES_NAMESPACE");
  const collection = env("VITE_FILES_COLLECTION");

  return {
    namespace: namespace || DEFAULT_FILES_NAMESPACE,
    collection: collection || DEFAULT_FILES_COLLECTION,
  };
}
