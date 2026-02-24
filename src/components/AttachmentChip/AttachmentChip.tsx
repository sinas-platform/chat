import { X } from "lucide-react";

import styles from "./AttachmentChip.module.scss";

type AttachmentChipProps = {
  name: string;
  size?: number;
  isUploading?: boolean;
  onRemove?: () => void;
  disabled?: boolean;
  thumbnailUrl?: string;
};

function formatBytes(sizeInBytes?: number): string {
  if (typeof sizeInBytes !== "number" || Number.isNaN(sizeInBytes) || sizeInBytes < 0) return "";

  if (sizeInBytes < 1024) return `${sizeInBytes} B`;
  if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`;
  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentChip({
  name,
  size,
  isUploading = false,
  onRemove,
  disabled = false,
  thumbnailUrl,
}: AttachmentChipProps) {
  const formattedSize = formatBytes(size);
  const isImageChip = typeof thumbnailUrl === "string" && thumbnailUrl.length > 0;

  return (
    <div className={`${styles.chip} ${isImageChip ? styles.imageChip : ""}`} title={name}>
      {isUploading ? <span className={styles.spinner} aria-hidden /> : null}

      {isImageChip ? (
        <img className={styles.thumbnail} src={thumbnailUrl} alt="" aria-hidden="true" />
      ) : (
        <div className={styles.content}>
          <span className={styles.name} title={name}>
            {name}
          </span>
          {formattedSize ? <span className={styles.meta}>{formattedSize}</span> : null}
        </div>
      )}

      {onRemove ? (
        <button
          type="button"
          className={styles.removeButton}
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove attachment ${name}`}
          title="Remove attachment"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
