import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider";
import { CloseIcon } from "./Icons";

interface ConfirmDialogProps {
  open: boolean;
  /** Small uppercase label above the title, e.g. the area the action belongs to. */
  kind: string;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button and icon as a destructive action. */
  danger?: boolean;
  icon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Themed replacement for `window.confirm`, rendered with the shared modal chrome. */
export function ConfirmDialog({
  open,
  kind,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  icon,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onCancel} />
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className={`modal-icon ${danger ? "danger" : "repository"}`} aria-hidden="true">{icon ?? "?"}</span>
            <div style={{ minWidth: 0 }}>
              <div className="kind">{kind}</div>
              <h3 id="confirm-dialog-title">{title}</h3>
            </div>
          </div>
          <button className="modal-close" type="button" aria-label={t("common.close")} onClick={onCancel}><CloseIcon /></button>
        </header>
        <div className="modal-body confirm-body">{message}</div>
        <footer className="confirm-foot">
          <button ref={cancelRef} type="button" className="btn ghost" onClick={onCancel}>{cancelLabel ?? t("common.cancel")}</button>
          <button type="button" className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
