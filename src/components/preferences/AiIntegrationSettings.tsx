import { useEffect, useState, type FormEvent } from "react";
import { fetchAiSettings, resetAiSettings, testAiSettings, updateAiSettings } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import type { AiProviderId, AiProviderInfo, AiSettingSource, AiSettingsSummary } from "../../types/ai";
import { ConfirmDialog } from "../common/ConfirmDialog";

type Notice = { kind: "ok" | "error"; text: string } | null;

const PROVIDER_GLYPHS: Record<AiProviderId, string> = {
  openai: "O",
  anthropic: "A",
  gemini: "G",
  openrouter: "R",
  custom: "⌁",
};

function SourceBadge({ source }: { source: AiSettingSource }) {
  const { t } = useI18n();
  return <span className={`ai-source ai-source-${source}`}>{t(`preferences.ai.source.${source}`)}</span>;
}

function ProviderCard({ info, selected, active, onSelect }: { info: AiProviderInfo; selected: boolean; active: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const keyTag = info.hasStoredKey ? "stored" : info.hasEnvKey ? "env" : info.requiresApiKey ? "none" : null;
  return (
    <button
      className={`ai-provider-card ${selected ? "selected" : ""}`}
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
    >
      <span className={`ai-provider-glyph ai-provider-glyph-${info.id}`} aria-hidden="true">{PROVIDER_GLYPHS[info.id]}</span>
      <span className="ai-provider-copy">
        <strong>{info.label}</strong>
        <small>{info.defaultModel ?? t("preferences.ai.customHint")}</small>
      </span>
      <span className="ai-provider-tags">
        {active ? <span className="ai-provider-tag active">{t("preferences.ai.active")}</span> : null}
        {keyTag ? <span className={`ai-provider-tag key-${keyTag}`}>{t(`preferences.ai.keyTag.${keyTag}`)}</span> : null}
      </span>
    </button>
  );
}

/**
 * Editor for the server-side AI provider. Values come from the environment by
 * default; anything saved here is stored in SQLite and takes precedence, and
 * each field shows which layer is currently in effect.
 */
export function AiIntegrationSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AiSettingsSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [provider, setProvider] = useState<AiProviderId>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "reset" | "removeKey" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  function applySummary(next: AiSettingsSummary) {
    setSettings(next);
    setProvider(next.provider.value);
    setApiKey("");
    setModel(next.model.source === "database" ? next.model.value ?? "" : "");
    setBaseUrl(next.baseUrl.source === "database" ? next.baseUrl.value : "");
  }

  useEffect(() => {
    let cancelled = false;
    fetchAiSettings()
      .then((result) => { if (!cancelled) applySummary(result.settings); })
      .catch((error: Error) => { if (!cancelled) setLoadError(error.message); });
    return () => { cancelled = true; };
  }, []);

  const info = settings?.providers.find((entry) => entry.id === provider) ?? null;
  const isActiveProvider = settings?.provider.value === provider;

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<AiSettingsSummary | string>) {
    setBusy(kind);
    setNotice(null);
    try {
      const result = await action();
      if (typeof result === "string") setNotice({ kind: "ok", text: result });
      else {
        applySummary(result);
        setNotice({ kind: "ok", text: t("preferences.ai.saved") });
      }
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function selectProvider(next: AiProviderId) {
    if (!settings) return;
    setProvider(next);
    setNotice(null);
    setApiKey("");
    const entry = settings.providers.find((item) => item.id === next);
    setModel(entry?.storedModel ?? "");
    setBaseUrl(entry?.storedBaseUrl ?? "");
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!info) return;
    if (!info.defaultModel && !model.trim() && !(isActiveProvider && settings?.model.value)) {
      setNotice({ kind: "error", text: t("preferences.ai.modelRequired") });
      return;
    }
    void run("save", async () => {
      const payload = { provider, model, baseUrl, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
      return (await updateAiSettings(payload)).settings;
    });
  }

  if (loadError) return <div className="error">{t("preferences.ai.loadError")}: {loadError}</div>;
  if (!settings || !info) return <div className="ai-settings-loading">{t("common.loading")}</div>;

  const activeInfo = settings.providers.find((entry) => entry.id === settings.provider.value);
  // Placeholders show what applies when the field is left empty.
  const keyPlaceholder = isActiveProvider && settings.apiKey.configured
    ? `${settings.apiKey.masked} · ${t("preferences.ai.apiKeyKeep")}`
    : info.hasEnvKey ? t("preferences.ai.envHint", { name: info.envKeyName }) : t("preferences.ai.apiKeyMissing");
  const modelPlaceholder = isActiveProvider && settings.model.source !== "database" && settings.model.value
    ? settings.model.value
    : info.defaultModel ?? t("preferences.ai.modelRequired");
  const baseUrlPlaceholder = isActiveProvider && settings.baseUrl.source !== "database" ? settings.baseUrl.value : info.defaultBaseUrl;
  const keySource: AiSettingSource = isActiveProvider ? settings.apiKey.source : info.hasStoredKey ? "database" : info.hasEnvKey ? "env" : "none";
  const modelSource: AiSettingSource = isActiveProvider ? settings.model.source : info.storedModel ? "database" : info.defaultModel ? "default" : "none";
  const baseUrlSource: AiSettingSource = isActiveProvider ? settings.baseUrl.source : info.storedBaseUrl ? "database" : "default";
  const hasOverrides = settings.provider.source === "database" || settings.providers.some((entry) => entry.hasStoredKey || entry.storedModel || entry.storedBaseUrl);
  const showBaseUrl = info.supportsBaseUrl || baseUrlSource !== "default" || Boolean(baseUrl);

  return (
    <form className="ai-settings" onSubmit={save}>
      <div className={`ai-hero ${settings.enabled ? "on" : ""}`}>
        <span className={`ai-status ${settings.enabled ? "on" : ""}`}>{settings.enabled ? t("preferences.ai.statusReady") : t("preferences.ai.statusIncomplete")}</span>
        <div className="ai-hero-copy">
          <strong>{activeInfo?.label}</strong>
          {settings.model.value ? <code>{settings.model.value}</code> : null}
        </div>
        <div className="ai-hero-sources">
          <span>{t("preferences.ai.provider")} <SourceBadge source={settings.provider.source} /></span>
          <span>{t("preferences.ai.apiKey")} <SourceBadge source={settings.apiKey.source} /></span>
          <span>{t("preferences.ai.model")} <SourceBadge source={settings.model.source} /></span>
        </div>
      </div>

      <div className="ai-block">
        <div className="ai-block-head">
          <span className="ai-block-title">{t("preferences.ai.provider")}</span>
          <span className="ai-block-hint">{t("preferences.ai.providerHint")}</span>
        </div>
        <div className="ai-provider-grid" role="radiogroup" aria-label={t("preferences.ai.provider")}>
          {settings.providers.map((entry) => (
            <ProviderCard
              key={entry.id}
              info={entry}
              selected={entry.id === provider}
              active={entry.id === settings.provider.value}
              onSelect={() => selectProvider(entry.id)}
            />
          ))}
        </div>
      </div>

      <div className="ai-block">
        <div className="ai-fields">
          <label className="ai-field ai-field-wide">
            <span className="ai-field-label">
              {info.requiresApiKey ? t("preferences.ai.apiKey") : t("preferences.ai.apiKeyOptional")}
              <SourceBadge source={apiKey.trim() ? "database" : keySource} />
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              placeholder={keyPlaceholder}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <small>{t("preferences.ai.envHint", { name: info.envKeyName })} · {t("preferences.ai.keyNote")}</small>
          </label>

          <label className={`ai-field ${showBaseUrl ? "" : "ai-field-wide"}`}>
            <span className="ai-field-label">{t("preferences.ai.model")}<SourceBadge source={model.trim() ? "database" : modelSource} /></span>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={model}
              placeholder={modelPlaceholder}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>

          {showBaseUrl ? (
            <label className="ai-field">
              <span className="ai-field-label">{t("preferences.ai.baseUrl")}<SourceBadge source={baseUrl.trim() ? "database" : baseUrlSource} /></span>
              <input
                type="url"
                autoComplete="off"
                spellCheck={false}
                value={baseUrl}
                placeholder={baseUrlPlaceholder}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      </div>

      <div className="ai-settings-actions">
        <button className="btn primary" type="submit" disabled={busy !== null}>{t("preferences.ai.save")}</button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy !== null || !settings.enabled}
          onClick={() => void run("test", async () => {
            const result = await testAiSettings();
            return t("preferences.ai.testOk", { model: result.model, ms: String(result.latencyMs) });
          })}
        >
          {busy === "test" ? t("preferences.ai.testing") : t("preferences.ai.test")}
        </button>
        {notice ? <span className={`ai-settings-notice ${notice.kind}`} role="status">{notice.text}</span> : null}
        <div className="spacer" />
        {info.hasStoredKey ? (
          <button className="ai-link-danger" type="button" disabled={busy !== null} onClick={() => void run("removeKey", async () => (await updateAiSettings({ provider, apiKey: "" })).settings)}>
            {t("preferences.ai.removeKey")}
          </button>
        ) : null}
        {hasOverrides ? (
          <button className="ai-link-danger" type="button" disabled={busy !== null} onClick={() => setConfirmReset(true)}>
            {t("preferences.ai.reset")}
          </button>
        ) : null}
      </div>

      <div className="ai-legend">
        <span className="ai-legend-title">{t("preferences.ai.legendTitle")}</span>
        <SourceBadge source="database" />
        <span className="ai-legend-arrow" aria-hidden="true">›</span>
        <SourceBadge source="env" />
        <span className="ai-legend-arrow" aria-hidden="true">›</span>
        <SourceBadge source="default" />
        <span className="ai-legend-text">{t("preferences.ai.legend")}</span>
      </div>

      <ConfirmDialog
        open={confirmReset}
        kind={t("preferences.ai")}
        title={t("preferences.ai.reset")}
        message={t("preferences.ai.resetConfirm")}
        confirmLabel={t("preferences.ai.reset")}
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); void run("reset", async () => (await resetAiSettings()).settings); }}
      />
    </form>
  );
}
