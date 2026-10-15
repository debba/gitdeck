import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  fetchGrowthSettings,
  resetGrowthSettings,
  updateGrowthSettings,
} from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import {
  GROWTH_CHANNELS,
  type GrowthChannel,
  type GrowthPillar,
  type GrowthSettings as GrowthSettingsData,
} from "../../types/growth";
import { createGrowthPillarId } from "../../utils/growth/profile";
import {
  GrowthSettingsValidationError,
  normalizeGrowthSettings,
} from "../../utils/growth/settings";

interface GrowthSettingsProps {
  accountId: string | null;
  enabled: boolean;
}

function editableSettings(settings: GrowthSettingsData): GrowthSettingsData {
  return {
    timezone: settings.timezone,
    cadence: { ...settings.cadence },
    pillars: settings.pillars.map((pillar) => ({ ...pillar })),
  };
}

export function GrowthSettings({ accountId, enabled }: GrowthSettingsProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<GrowthSettingsData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const actionController = useRef<AbortController | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const resetCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    actionController.current?.abort();
    actionController.current = null;
    setSettings(null);
    setBusy(false);
    setError("");
    setSaved(false);
    setResetComplete(false);
    setResetArmed(false);
    if (!enabled || !accountId) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void fetchGrowthSettings(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSettings(editableSettings(result));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setError(t("growth.settingsLoadError", { message: (cause as Error).message }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      actionController.current?.abort();
    };
  }, [accountId, enabled, t]);

  useEffect(() => {
    if (!resetArmed) return;
    resetCancelRef.current?.focus();
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setResetArmed(false);
    }
    window.addEventListener("keydown", cancelOnEscape);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape);
      if (resetButtonRef.current?.isConnected) resetButtonRef.current.focus();
    };
  }, [resetArmed]);

  function clearFeedback() {
    setError("");
    setSaved(false);
    setResetComplete(false);
    setResetArmed(false);
  }

  function changeSettings(updates: Partial<GrowthSettingsData>) {
    if (busy) return;
    setSettings((current) => current ? { ...current, ...updates } : current);
    clearFeedback();
  }

  function changeCadence(channel: GrowthChannel, value: number) {
    if (!settings) return;
    changeSettings({ cadence: { ...settings.cadence, [channel]: value } });
  }

  function changePillar(index: number, updates: Partial<GrowthPillar>) {
    if (!settings) return;
    changeSettings({
      pillars: settings.pillars.map((pillar, pillarIndex) => (
        pillarIndex === index ? { ...pillar, ...updates } : pillar
      )),
    });
  }

  function addPillar() {
    if (!settings) return;
    changeSettings({
      pillars: [...settings.pillars, {
        id: createGrowthPillarId(settings.pillars),
        label: "",
        weight: 0,
        description: "",
      }],
    });
  }

  function removePillar(index: number) {
    if (!settings || settings.pillars.length === 1) return;
    changeSettings({
      pillars: settings.pillars.filter((_, pillarIndex) => pillarIndex !== index),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || !settings || busy || actionController.current) return;
    setError("");
    setSaved(false);
    setResetComplete(false);
    setResetArmed(false);

    let normalized: GrowthSettingsData;
    try {
      normalized = normalizeGrowthSettings(settings);
    } catch (cause) {
      const message = cause instanceof GrowthSettingsValidationError
        ? cause.message
        : t("growth.settingsInvalid");
      setError(t("growth.settingsValidationError", { message }));
      return;
    }

    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    try {
      const result = await updateGrowthSettings(normalized, controller.signal);
      if (controller.signal.aborted) return;
      setSettings(editableSettings(result));
      setSaved(true);
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setError(t("growth.settingsSaveError", { message: (cause as Error).message }));
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (actionController.current === controller) actionController.current = null;
    }
  }

  async function confirmReset() {
    if (!accountId || busy || actionController.current) return;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setError("");
    setSaved(false);
    setResetComplete(false);
    try {
      const result = await resetGrowthSettings(controller.signal);
      if (controller.signal.aborted) return;
      setSettings(editableSettings(result));
      setResetArmed(false);
      setResetComplete(true);
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
        setError(t("growth.settingsResetError", { message: (cause as Error).message }));
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (actionController.current === controller) actionController.current = null;
    }
  }

  return (
    <div className="growth-library growth-settings">
      <header className="growth-library-hero">
        <span>{t("growth.settingsEyebrow")}</span>
        <h1>{t("growth.settingsTitle")}</h1>
        <p>{t("growth.settingsDescription")}</p>
      </header>

      {loading ? (
        <div className="growth-library-state" role="status" aria-busy="true">
          {t("growth.settingsLoading")}
        </div>
      ) : null}
      {error ? <div className="growth-library-error" role="alert">{error}</div> : null}

      {settings ? (
        <form className="growth-library-form growth-settings-form" aria-busy={busy} onSubmit={(event) => void submit(event)}>
          <fieldset className="growth-settings-fieldset" disabled={busy}>
            <section className="growth-library-card">
              <div className="growth-library-section-heading">
                <div>
                  <span>{t("growth.settingsTimezoneEyebrow")}</span>
                  <h2>{t("growth.settingsTimezoneTitle")}</h2>
                  <p>{t("growth.settingsTimezoneDescription")}</p>
                </div>
              </div>
              <div className="growth-library-fields growth-settings-timezone">
                <label>
                  {t("growth.libraryTimezone")}
                  <input
                    value={settings.timezone}
                    required
                    placeholder={t("growth.libraryTimezonePlaceholder")}
                    onChange={(event) => changeSettings({ timezone: event.target.value })}
                  />
                </label>
              </div>
            </section>

            <section className="growth-library-card">
              <div className="growth-library-section-heading">
                <div>
                  <span>{t("growth.libraryCadenceEyebrow")}</span>
                  <h2>{t("growth.settingsCadenceTitle")}</h2>
                  <p>{t("growth.settingsCadenceDescription")}</p>
                </div>
              </div>
              <div className="growth-library-cadence-grid">
                {GROWTH_CHANNELS.map((channel) => (
                  <label key={channel}>
                    <span>{t(`growth.channel.${channel}`)}</span>
                    <input
                      type="number"
                      min={0}
                      max={14}
                      step={1}
                      value={settings.cadence[channel]}
                      onChange={(event) => changeCadence(channel, event.target.valueAsNumber)}
                    />
                    <small>{t("growth.libraryPostsPerWeek")}</small>
                  </label>
                ))}
              </div>
            </section>

            <section className="growth-library-card">
              <div className="growth-library-section-heading">
                <div>
                  <span>{t("growth.libraryPillarsEyebrow")}</span>
                  <h2>{t("growth.settingsPillarsTitle")}</h2>
                  <p>{t("growth.settingsPillarsDescription")}</p>
                </div>
                <button className="btn ghost" type="button" onClick={addPillar}>
                  {t("growth.libraryAddPillar")}
                </button>
              </div>
              <div className="growth-library-pillar-list">
                {settings.pillars.map((pillar, index) => (
                  <div className="growth-library-pillar" key={index}>
                    <label>
                      {t("growth.libraryPillarId")}
                      <input value={pillar.id} required onChange={(event) => changePillar(index, { id: event.target.value })} />
                    </label>
                    <label>
                      {t("growth.libraryPillarLabel")}
                      <input value={pillar.label} required onChange={(event) => changePillar(index, { label: event.target.value })} />
                    </label>
                    <label>
                      {t("growth.libraryPillarWeight")}
                      <input type="number" min={0} max={100} step={1} value={pillar.weight} onChange={(event) => changePillar(index, { weight: event.target.valueAsNumber })} />
                    </label>
                    <label className="growth-library-pillar-description">
                      {t("growth.libraryPillarDescription")}
                      <input value={pillar.description} onChange={(event) => changePillar(index, { description: event.target.value })} />
                    </label>
                    <button
                      className="btn ghost danger"
                      type="button"
                      disabled={settings.pillars.length === 1}
                      aria-label={t("growth.libraryRemovePillar", { label: pillar.label || pillar.id })}
                      onClick={() => removePillar(index)}
                    >×</button>
                  </div>
                ))}
              </div>
            </section>
          </fieldset>

          {resetArmed ? (
            <section className="growth-settings-reset-confirmation" role="alertdialog" aria-labelledby="growth-settings-reset-title">
              <div>
                <strong id="growth-settings-reset-title">{t("growth.settingsResetConfirmTitle")}</strong>
                <p>{t("growth.settingsResetConfirmDescription")}</p>
              </div>
              <div>
                <button ref={resetCancelRef} className="btn ghost" type="button" disabled={busy} onClick={() => setResetArmed(false)}>
                  {t("common.cancel")}
                </button>
                <button className="btn danger" type="button" disabled={busy} onClick={() => void confirmReset()}>
                  {busy ? t("growth.settingsResetting") : t("growth.settingsResetConfirm")}
                </button>
              </div>
            </section>
          ) : null}

          <footer className="growth-library-savebar growth-settings-savebar">
            <a href="/preferences#preferences-ai" target="_blank" rel="noopener">
              {t("growth.settingsAiLink")}
            </a>
            <span role="status">
              {saved ? t("growth.settingsSaved") : resetComplete ? t("growth.settingsResetComplete") : ""}
            </span>
            <button ref={resetButtonRef} className="btn ghost danger" type="button" disabled={busy} onClick={() => { setResetArmed(true); setSaved(false); setResetComplete(false); setError(""); }}>
              {t("growth.settingsReset")}
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? t("growth.settingsSaving") : t("growth.settingsSave")}
            </button>
          </footer>
        </form>
      ) : null}
    </div>
  );
}
