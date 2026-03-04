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

  const handleSave = () => {
    setTouched(true);
    if (parsedUrl.success) onSave(parsedUrl.data);
  };

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

          <Button variant="minimal" className={styles.closeButton} onClick={onClose} aria-label="Close">
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
            placeholder="https://workspace.example.com"
            autoFocus
            endActionClassName={styles.inputActionWrapper}
            endAction={
              <Button
                variant="minimal"
                type="button"
                className={styles.inputAction}
                onClick={handleSave}
                disabled={!valid}
              >
                Save
              </Button>
            }
          />
        </label>

        {touched && !valid && <div className={styles.error}>{errorMessage}</div>}
      </div>
    </div>
  );
}
