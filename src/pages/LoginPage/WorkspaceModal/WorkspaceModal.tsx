import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Input } from "../../../components/Input/Input.tsx";
import { Button } from "../../../components/Button/Button.tsx";
import { workspaceUrlSchema } from "../../../lib/validation";
import styles from "./WorkspaceModal.module.scss";

type Props = {
  open: boolean;
  initialValue: string;
  onClose: () => void;
  onSave: (url: string) => void;
};

export function WorkspaceModal({ open, initialValue, onClose, onSave }: Props) {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setTouched(false);
    }
  }, [open, initialValue]);

  const parsedUrl = useMemo(() => workspaceUrlSchema.safeParse(value), [value]);
  const valid = parsedUrl.success;
  const errorMessage = valid ? "" : (parsedUrl.error.issues[0]?.message ?? "Please enter a valid http(s) URL.");

  if (!open) return null;

  return (
    <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Switch workspace">
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Switch workspace</div>
            <div className={styles.subTitle}>Enter your Sinas server URL</div>
          </div>

          <Button variant="icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Workspace URL</span>
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTouched(true);
            }}
            placeholder="https://pulsr.sinas.cloud"
            autoFocus
          />
        </label>

        {touched && !valid && <div className={styles.error}>{errorMessage}</div>}

        <div className={styles.actions}>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => {
              if (parsedUrl.success) onSave(parsedUrl.data);
            }}
            disabled={!valid}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
