import { useEffect, useRef, useState } from "react";
import { useAccounts } from "../contexts/AccountContext";
import { useI18n } from "../i18n/I18nProvider";
import { AddAccountModal } from "./AddAccountModal";
import { ProviderLogo } from "./common/ProviderLogo";

export function AccountSwitcher() {
  const { accounts, active, switchAccount, removeAccount } = useAccounts();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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

  if (accounts.length === 0) return null;

  async function handleSelect(id: string) {
    setOpen(false);
    try {
      await switchAccount(id);
    } catch {
      // refresh effect surfaces the error
    }
  }

  async function handleRemove(event: React.MouseEvent, id: string, label: string) {
    event.stopPropagation();
    if (!window.confirm(t("accounts.removeConfirm").replace("{name}", label))) return;
    try {
      await removeAccount(id);
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
          aria-haspopup="listbox"
          aria-expanded={open}
          title={t("accounts.switch")}
          onClick={() => setOpen((value) => !value)}
        >
          {active ? <ProviderLogo kind={active.providerKind} small className="account-switcher-trigger-logo" /> : null}
          <span className="label">{active?.login ?? active?.label ?? t("accounts.select")}</span>
        </button>
        {open ? (
          <div className="account-switcher-popover" role="listbox" aria-label={t("accounts.switch")}>
            {accounts.map((account) => {
              const isActive = account.id === active?.id;
              const labelText = account.login ?? account.label;
              return (
                <div
                  key={account.id}
                  role="option"
                  aria-selected={isActive}
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
                          onClick={(event) => void handleRemove(event, account.id, labelText)}
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
            <button
              type="button"
              className="account-switcher-add"
              onClick={() => {
                setOpen(false);
                setAddOpen(true);
              }}
            >
              + {t("accounts.add")}
            </button>
          </div>
        ) : null}
      </div>
      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
