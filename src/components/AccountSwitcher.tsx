import { useEffect, useRef, useState } from "react";
import { useAccounts } from "../contexts/AccountContext";
import { useI18n } from "../i18n/I18nProvider";
import { AddAccountModal } from "./AddAccountModal";
import { ConfirmDialog } from "./common/ConfirmDialog";
import { ProviderLogo } from "./common/ProviderLogo";

interface AccountSwitcherProps {
  /** Login of the authenticated user, used when the account store has no entry yet. */
  authLogin: string | null;
  /** Whether the current auth mode supports signing out from the UI. */
  canLogout: boolean;
  onSignOut: () => void;
}

type PendingAction =
  | { kind: "sign-out" }
  | { kind: "remove"; id: string; label: string };

const SIGN_OUT_ICON = (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
);

/**
 * Single account control at the right end of the top bar: shows who is signed
 * in, switches between accounts, adds or removes them, and signs out.
 */
export function AccountSwitcher({ authLogin, canLogout, onSignOut }: AccountSwitcherProps) {
  const { accounts, active, switchAccount, removeAccount } = useAccounts();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const currentLabel = active?.login ?? active?.label ?? authLogin;
  if (accounts.length === 0 && !currentLabel) return null;

  async function handleSelect(id: string) {
    setOpen(false);
    try {
      await switchAccount(id);
    } catch {
      // refresh effect surfaces the error
    }
  }

  function requestRemove(event: React.MouseEvent, id: string, label: string) {
    event.stopPropagation();
    setOpen(false);
    setPending({ kind: "remove", id, label });
  }

  function requestSignOut() {
    setOpen(false);
    setPending({ kind: "sign-out" });
  }

  async function confirmPending() {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === "sign-out") {
      onSignOut();
      return;
    }
    try {
      await removeAccount(action.id);
    } catch {
      // refresh effect surfaces the error
    }
  }

  return (
    <>
      <div className="account-switcher" ref={ref}>
        <button
          type="button"
          className={`btn account-switcher-btn ${open ? "active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={currentLabel ? `${t("common.signedIn")} · ${currentLabel}` : t("accounts.switch")}
          onClick={() => setOpen((value) => !value)}
        >
          {active ? <ProviderLogo kind={active.providerKind} small className="account-switcher-trigger-logo" /> : null}
          <span className="label">{currentLabel ?? t("accounts.select")}</span>
        </button>
        {open ? (
          <div className="account-switcher-popover" role="menu" aria-label={t("accounts.switch")}>
            {accounts.map((account) => {
              const isActive = account.id === active?.id;
              const labelText = account.login ?? account.label;
              return (
                <div
                  key={account.id}
                  role="menuitemradio"
                  aria-checked={isActive}
                  className={`account-switcher-item ${isActive ? "active" : ""}`}
                  onClick={() => void handleSelect(account.id)}
                >
                  <ProviderLogo kind={account.providerKind} small className="account-switcher-provider-logo" />
                  <div className="account-switcher-item-body">
                    <div className="account-switcher-row">
                      <span className="account-switcher-label">{labelText}</span>
                      {!isActive && !account.ephemeral ? (
                        <button
                          type="button"
                          className="account-switcher-remove"
                          aria-label={t("accounts.remove").replace("{name}", labelText)}
                          title={t("accounts.remove").replace("{name}", labelText)}
                          onClick={(event) => requestRemove(event, account.id, labelText)}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                    <span className="account-switcher-meta">{account.providerConfigId}</span>
                  </div>
                </div>
              );
            })}
            <div className="account-switcher-footer">
              <button
                type="button"
                role="menuitem"
                className="account-switcher-add"
                onClick={() => {
                  setOpen(false);
                  setAddOpen(true);
                }}
              >
                + {t("accounts.add")}
              </button>
              {canLogout ? (
                <button type="button" role="menuitem" className="account-switcher-signout" onClick={requestSignOut}>
                  {SIGN_OUT_ICON}
                  <span>{t("common.signOut")}</span>
                </button>
              ) : (
                <span className="account-switcher-external" title={t("common.authenticatedExternally")}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  {t("common.authenticatedExternally")}
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ConfirmDialog
        open={pending?.kind === "sign-out"}
        kind={t("accounts.kind")}
        title={t("auth.signOutTitle")}
        message={<p>{t("auth.signOutMessage", { name: currentLabel ?? "" })}</p>}
        confirmLabel={t("common.signOut")}
        danger
        icon={SIGN_OUT_ICON}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === "remove"}
        kind={t("accounts.kind")}
        title={t("accounts.removeTitle")}
        message={<p>{t("accounts.removeConfirm", { name: pending?.kind === "remove" ? pending.label : "" })}</p>}
        confirmLabel={t("common.remove")}
        danger
        icon="×"
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
