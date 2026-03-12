import { useEffect, useMemo, useState } from "react";
import { Input } from "../../../components/Input/Input.tsx";
import { Button } from "../../../components/Button/Button.tsx";
import CrossIcon from "../../../icons/cross.svg?react";
import { workspaceUrlSchema } from "../../../lib/validation";
import styles from "./WorkspaceModal.module.scss";

type Props = {
  open: boolean;
  initialValue: string;
  onClose: () => void;
  onSave: (url: string) => void;
};

function stripWorkspaceProtocol(input: string) {
  return input.trim().replace(/^https?:\/\//i, "").replace(/^\/+/, "");
}

export function WorkspaceModal({ open, initialValue, onClose, onSave }: Props) {
  const [value, setValue] = useState(stripWorkspaceProtocol(initialValue));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(stripWorkspaceProtocol(initialValue));
      setTouched(false);
    }
  }, [open, initialValue]);

  const fullWorkspaceUrl = useMemo(() => (value.trim() ? `https://${value.trim()}` : ""), [value]);
  const parsedUrl = useMemo(() => workspaceUrlSchema.safeParse(fullWorkspaceUrl), [fullWorkspaceUrl]);
  const valid = parsedUrl.success;
  const rawErrorMessage = valid ? "" : (parsedUrl.error.issues[0]?.message ?? "Please enter a valid https URL.");
  const errorMessage = rawErrorMessage === "Please enter a valid http(s) URL." ? "Please enter a valid https URL." : rawErrorMessage;

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
            <CrossIcon className={styles.closeIcon} aria-hidden="true" />
          </Button>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Workspace URL</span>
          <Input
            value={value}
            onChange={(e) => {
              setValue(stripWorkspaceProtocol(e.target.value));
              setTouched(true);
            }}
            placeholder="workspace.example.com"
            autoFocus
            className={styles.workspaceInput}
            wrapperClassName={styles.workspaceInputWrapper}
            endActionClassName={styles.inputActionWrapper}
            endAction={
              <Button
                variant="minimal"
                type="button"
                className={styles.inputAction}
                onClick={handleSave}
                disabled={!valid}
              >
                <span className={styles.inputActionContent}>Save</span>
              </Button>
            }
          />
        </label>

        {touched && !valid && <div className={styles.error}>{errorMessage}</div>}
      </div>
    </div>
  );
}
