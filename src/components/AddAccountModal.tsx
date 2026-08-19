import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addTokenAccount,
  fetchProviderConfigs,
  pollAuthFlow,
  startAuthFlow,
  type DeviceFlowStart,
  type ProviderConfigSummary,
} from "../api/github";
import { useI18n } from "../i18n/I18nProvider";
import { useAccounts } from "../contexts/AccountContext";
import { ProviderLogo } from "./common/ProviderLogo";
import { gitLabTokenSettingsUrl, isSameGitLabInstance } from "../utils/gitlab";

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "choose" | "device" | "token" | "gitlab" | "success";
type DevicePhase = "starting" | "awaiting" | "error";

export function AddAccountModal({ open, onClose }: AddAccountModalProps) {
  const { t } = useI18n();
  const { refresh } = useAccounts();
  const [configs, setConfigs] = useState<ProviderConfigSummary[]>([]);
  const [step, setStep] = useState<Step>("choose");
  const [selected, setSelected] = useState<ProviderConfigSummary | null>(null);
  const [flow, setFlow] = useState<DeviceFlowStart | null>(null);
  const [devicePhase, setDevicePhase] = useState<DevicePhase>("starting");
  const [token, setToken] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const intervalRef = useRef<number | null>(null);

  function stopPolling() {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    if (!open) {
      stopPolling();
      setStep("choose");
      setSelected(null);
      setFlow(null);
      setToken("");
      setInstanceUrl("");
      setError("");
      setCopied(false);
      setSubmitting(false);
      return;
    }
    void fetchProviderConfigs()
      .then((res) => setConfigs(res.configs))
      .catch((err) => setError((err as Error).message));
  }, [open]);

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  async function pickProvider(config: ProviderConfigSummary) {
    setError("");
    setSelected(config);
    if (config.kind === "gitlab") {
      setInstanceUrl(config.webUrl);
      setStep("gitlab");
    } else if (config.supportsDeviceFlow) {
      setStep("device");
      setDevicePhase("starting");
      try {
        const data = await startAuthFlow();
        setFlow(data);
        setDevicePhase("awaiting");
        const intervalMs = Math.max(2, data.interval) * 1000;
        intervalRef.current = window.setInterval(() => void poll(), intervalMs);
      } catch (err) {
        setDevicePhase("error");
        setError((err as Error).message);
      }
    } else {
      setStep("token");
    }
  }

  async function poll() {
    try {
      const result = await pollAuthFlow();
      if (!("status" in result)) return;
      if (result.status === "ok") {
        stopPolling();
        setStep("success");
        await refresh();
        window.setTimeout(() => onClose(), 800);
        return;
      }
      if (result.status === "expired") {
        stopPolling();
        setDevicePhase("error");
        setError(t("auth.expired"));
        return;
      }
      if (result.status === "denied") {
        stopPolling();
        setDevicePhase("error");
        setError(t("auth.denied"));
        return;
      }
      if (result.status === "error") {
        stopPolling();
        setDevicePhase("error");
        setError(result.error);
      }
    } catch (err) {
      stopPolling();
      setDevicePhase("error");
      setError((err as Error).message);
    }
  }

  async function copyCode() {
    if (!flow) return;
    try {
      await navigator.clipboard.writeText(flow.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  function startGitLabOAuth() {
    const url = instanceUrl.trim();
    if (!url) {
      setError(t("accounts.instanceUrlRequired"));
      return;
    }
    window.location.assign(`/api/auth/gitlab/start?${new URLSearchParams({ instanceUrl: url })}`);
  }

  async function submitToken(event: React.FormEvent) {
    event.preventDefault();
    const customGitLab = step === "gitlab";
    if (!selected && !customGitLab) return;
    const trimmed = token.trim();
    if (!trimmed) {
      setError(t("accounts.tokenRequired"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await addTokenAccount(customGitLab
        ? { instanceUrl: instanceUrl.trim(), token: trimmed }
        : { providerConfigId: selected?.id, token: trimmed });
      setStep("success");
      await refresh();
      window.setTimeout(() => onClose(), 800);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="add-account-backdrop" role="dialog" aria-modal="true" aria-label={t("accounts.add")}>
      <div className="add-account-card">
        <div className="add-account-header">
          <h2>{t("accounts.add")}</h2>
          <button className="add-account-close" type="button" aria-label={t("common.close")} onClick={onClose}>×</button>
        </div>

        {step === "choose" ? (
          <div className="add-account-providers">
            <p className="auth-status">{t("accounts.pickProvider")}</p>
            {configs.length === 0 && !error ? <p className="auth-hint">{t("common.loading")}</p> : null}
            {configs.map((config) => (
              <button
                key={config.id}
                type="button"
                className="add-account-provider"
                onClick={() => void pickProvider(config)}
              >
                <ProviderLogo kind={config.kind} />
                <span className="add-account-provider-body">
                  <span className="add-account-provider-label">{config.label}</span>
                  <span className="add-account-provider-meta">
                    {config.kind === "github" && config.supportsDeviceFlow
                      ? t("accounts.viaDeviceFlow")
                      : config.kind === "gitlab" && config.supportsOAuth
                        ? t("accounts.viaOAuthOrToken")
                        : t("accounts.viaToken")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {step === "device" && devicePhase === "starting" ? (
          <p className="auth-status">{t("auth.requestingCode")}</p>
        ) : null}

        {step === "device" && devicePhase === "awaiting" && flow ? (
          <div className="auth-flow">
            <p className="auth-status">{t("auth.openVerification")}</p>
            <a className="auth-link" href={flow.verificationUri} target="_blank" rel="noreferrer">
              {flow.verificationUri}
            </a>
            <div className="auth-code-row">
              <code className="auth-code">{flow.userCode}</code>
              <button className="auth-secondary" type="button" onClick={() => void copyCode()}>
                {copied ? t("auth.copied") : t("auth.copy")}
              </button>
            </div>
            <p className="auth-hint">{t("auth.waiting")}</p>
          </div>
        ) : null}

        {(step === "token" && selected) || step === "gitlab" ? (
          <form className="add-account-token" onSubmit={(event) => void submitToken(event)}>
            <p className="auth-status">
              {t("accounts.tokenHelp").replace("{provider}", selected?.label ?? "GitLab")}
            </p>
            {step === "gitlab" ? (
              <label className="add-account-field">
                <span>{t("accounts.instanceUrl")}</span>
                <input
                  type="url"
                  value={instanceUrl}
                  autoComplete="url"
                  onChange={(event) => setInstanceUrl(event.target.value)}
                  placeholder="https://gitlab.example.com"
                  required
                  autoFocus
                />
              </label>
            ) : selected ? (
              <a className="auth-link" href={selected.tokenSettingsUrl} target="_blank" rel="noreferrer">
                {selected.tokenSettingsUrl}
              </a>
            ) : null}
            {step === "gitlab" && selected?.supportsOAuth && isSameGitLabInstance(instanceUrl, selected.oauthInstanceUrl) ? (
              <>
                <button className="auth-primary" type="button" onClick={startGitLabOAuth}>
                  {t("accounts.connectOAuth")}
                </button>
                <div className="auth-divider"><span>{t("accounts.orToken")}</span></div>
              </>
            ) : null}
            {step === "gitlab" && gitLabTokenSettingsUrl(instanceUrl) ? (
              <a className="auth-link" href={gitLabTokenSettingsUrl(instanceUrl) ?? undefined} target="_blank" rel="noreferrer">
                {gitLabTokenSettingsUrl(instanceUrl)}
              </a>
            ) : null}
            <label className="add-account-field">
              <span>{t("accounts.tokenLabel")}</span>
              <input
                type="password"
                value={token}
                autoComplete="off"
                onChange={(event) => setToken(event.target.value)}
                placeholder="●●●●●●●●"
                autoFocus={step !== "gitlab"}
              />
            </label>
            <button className="auth-primary" type="submit" disabled={submitting}>
              {submitting ? t("common.loading") : t("accounts.add")}
            </button>
          </form>
        ) : null}

        {step === "success" ? <p className="auth-status">{t("accounts.added")}</p> : null}

        {error ? <p className="auth-error-line">{error}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
