import { useEffect, useRef, useState } from "react";
import {
  addTokenAccount,
  fetchAuthStatus,
  fetchProviderConfigs,
  pollAuthFlow,
  startAuthFlow,
  type AuthStatus,
  type DeviceFlowStart,
  type ProviderConfigSummary,
} from "../api/github";
import appLogo from "../assets/app-logo-mark.svg";
import { useI18n } from "../i18n/I18nProvider";
import { ProviderLogo } from "./common/ProviderLogo";
import { gitLabTokenSettingsUrl, isSameGitLabInstance } from "../utils/gitlab";

interface AuthGateProps {
  onAuthenticated: (login: string) => void;
}

type Step = "choose" | "device" | "token" | "gitlab" | "success";
type DevicePhase = "starting" | "awaiting" | "error";

export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AuthStatus | null>(null);
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

  useEffect(() => {
    void fetchAuthStatus().then(setStatus).catch(() => setStatus(null));
    void fetchProviderConfigs()
      .then((res) => setConfigs(res.configs))
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => () => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
  }, []);

  function stopPolling() {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function poll() {
    try {
      const result = await pollAuthFlow();
      if (!("status" in result)) return;
      if (result.status === "ok") {
        stopPolling();
        setStep("success");
        onAuthenticated(result.login);
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
      try {
        const refreshed = await fetchAuthStatus();
        onAuthenticated(refreshed.login ?? selected?.label ?? t("accounts.customGitLab"));
      } catch {
        onAuthenticated(selected?.label ?? t("accounts.customGitLab"));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function backToChoice() {
    stopPolling();
    setStep("choose");
    setSelected(null);
    setFlow(null);
    setToken("");
    setInstanceUrl("");
    setError("");
    setCopied(false);
    setDevicePhase("starting");
  }

  const mode = status?.mode ?? "device";
  const externalMode = mode === "gh-cli" || mode === "token";
  const clientMissing = status?.clientIdConfigured === false && selected?.supportsDeviceFlow;
  const showBack = !externalMode && (step === "device" || step === "token" || step === "gitlab");

  return (
    <div className="auth-gate">
      <div className="auth-aura" aria-hidden="true" />
      <div className="auth-card">
        <header className="auth-brand">
          <span className="auth-brand-logo">
            <img src={appLogo} alt="" />
          </span>
          <span className="auth-brand-text">
            <span className="auth-brand-name">{t("app.title")}</span>
            <span className="auth-brand-tag">{t("auth.brandTag")}</span>
          </span>
        </header>

        {externalMode ? (
          <>
            <h1 className="auth-title">{t("auth.signIn")}</h1>
            <div className="auth-error">
              <strong>
                {mode === "gh-cli" ? t("auth.ghCliNotReady") : t("auth.tokenMissing")}
              </strong>
              <p>
                {mode === "gh-cli" ? (
                  <>
                    {t("auth.ghCliHelp")}{" "}
                    <a href="https://cli.github.com/" target="_blank" rel="noreferrer">gh CLI</a>
                    <br />
                    <code>gh auth login</code>
                    {", "}{t("auth.ghCliReload")}
                  </>
                ) : (
                  <>{t("auth.tokenHelp")}</>
                )}
              </p>
              {status?.detail ? <p><small>{status.detail}</small></p> : null}
            </div>
          </>
        ) : null}

        {!externalMode && step === "choose" ? (
          <>
            <h1 className="auth-title">{t("auth.signIn")}</h1>
            <p className="auth-sub">{t("auth.description")}</p>
            <div className="auth-providers" role="list">
              {configs.length === 0 && !error ? (
                <p className="auth-hint auth-hint-center">{t("common.loading")}</p>
              ) : null}
              {configs.map((config) => (
                <button
                  key={config.id}
                  type="button"
                  role="listitem"
                  className="auth-provider"
                  onClick={() => void pickProvider(config)}
                >
                  <ProviderLogo kind={config.kind} />
                  <span className="auth-provider-body">
                    <span className="auth-provider-label">{config.label}</span>
                    <span className="auth-provider-meta">
                      {config.kind === "github" && config.supportsDeviceFlow
                        ? t("accounts.viaDeviceFlow")
                        : config.kind === "gitlab" && config.supportsOAuth
                          ? t("accounts.viaOAuthOrToken")
                          : t("accounts.viaToken")}
                    </span>
                  </span>
                  <ChevronIcon />
                </button>
              ))}
            </div>
          </>
        ) : null}

        {!externalMode && (step === "device" || step === "token" || step === "gitlab") && selected ? (
          <div className="auth-provider-header">
            <ProviderLogo kind={selected.kind} small />
            <span className="auth-provider-header-text">
              <span className="auth-provider-header-label">{selected.label}</span>
              <span className="auth-provider-header-meta">
                {selected.supportsDeviceFlow
                  ? t("accounts.viaDeviceFlow")
                  : selected.kind === "gitlab" && selected.supportsOAuth
                    ? t("accounts.viaOAuthOrToken")
                    : t("accounts.viaToken")}
              </span>
            </span>
          </div>
        ) : null}

        {clientMissing && step === "device" ? (
          <div className="auth-error">
            <strong>{t("auth.clientMissing")}</strong>
            <p>
              {t("auth.clientHelp").split("github.com/settings/developers")[0]}
              <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">
                github.com/settings/developers
              </a>
              {t("auth.clientHelp").split("github.com/settings/developers")[1]}
            </p>
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
              <ExternalIcon />
            </a>
            <div className="auth-code-row">
              <code className="auth-code">{flow.userCode}</code>
              <button className="auth-secondary" type="button" onClick={() => void copyCode()}>
                {copied ? t("auth.copied") : t("auth.copy")}
              </button>
            </div>
            <p className="auth-hint">
              <span className="auth-spinner" aria-hidden="true" />
              {t("auth.waiting")}
            </p>
          </div>
        ) : null}

        {(step === "token" && selected) || step === "gitlab" ? (
          <form className="auth-form" onSubmit={(event) => void submitToken(event)}>
            <p className="auth-status">
              {t("accounts.tokenHelp").replace("{provider}", selected?.label ?? "GitLab")}
            </p>
            {step === "gitlab" ? (
              <label className="auth-field">
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
                <ExternalIcon />
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
                <ExternalIcon />
              </a>
            ) : null}
            <label className="auth-field">
              <span>{t("accounts.tokenLabel")}</span>
              <input
                type="password"
                value={token}
                autoComplete="off"
                onChange={(event) => setToken(event.target.value)}
                placeholder="●●●●●●●●●●●●●●●●"
                autoFocus={step !== "gitlab"}
              />
            </label>
            <button className="auth-primary" type="submit" disabled={submitting}>
              {submitting ? t("common.loading") : t("auth.continue")}
            </button>
          </form>
        ) : null}

        {step === "success" ? (
          <div className="auth-success">
            <span className="auth-success-check" aria-hidden="true">✓</span>
            <p className="auth-status">{t("auth.success")}</p>
          </div>
        ) : null}

        {error ? <p className="auth-error-line">{error}</p> : null}

        {showBack ? (
          <button className="auth-back" type="button" onClick={backToChoice}>
            <span aria-hidden="true">←</span> {t("auth.changeProvider")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg className="auth-provider-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
    </svg>
  );
}
