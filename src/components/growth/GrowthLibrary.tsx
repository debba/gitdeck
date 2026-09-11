import { useEffect, useState, type FormEvent } from "react";
import { fetchGrowthProfile, updateGrowthProfile } from "../../api/growth";
import { useI18n } from "../../i18n/I18nProvider";
import {
  GROWTH_CHANNELS,
  type GrowthChannel,
  type GrowthPillar,
  type GrowthPostingWindow,
  type GrowthProfile,
  type GrowthProfileInput,
} from "../../types/growth";
import type { GhRepo } from "../../types/github";
import {
  createGrowthPillarId,
  GrowthProfileValidationError,
  normalizeGrowthProfileInput,
} from "../../utils/growth/profile";
import { RepositoryContentSources } from "../common/RepositoryContentSources";
import { GrowthAssetLibrary } from "./GrowthAssetLibrary";

interface GrowthLibraryProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
  repos: GhRepo[];
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function editableProfile(profile: GrowthProfile): GrowthProfileInput {
  return {
    language: profile.language,
    voice: profile.voice,
    audience: profile.audience,
    channels: { ...profile.channels },
    cadence: { ...profile.cadence },
    pillars: profile.pillars.map((pillar) => ({ ...pillar })),
    hashtags: [...profile.hashtags],
    avoid: profile.avoid,
    timezone: profile.timezone,
    postingWindows: profile.postingWindows.map((window) => ({ ...window })),
    color: profile.color,
  };
}

export function GrowthLibrary({ accountId, enabled, repository, repos }: GrowthLibraryProps) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<GrowthProfileInput | null>(null);
  const [hashtags, setHashtags] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setProfile(null);
    setHashtags("");
    setError("");
    setSaved(false);
    if (!enabled || !accountId || !repository) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void fetchGrowthProfile(repository, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setProfile(editableProfile(result));
        setHashtags(result.hashtags.join(", "));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setError(t("growth.libraryLoadError", { message: (cause as Error).message }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountId, enabled, repository, t]);

  function changeProfile(updates: Partial<GrowthProfileInput>) {
    setProfile((current) => current ? { ...current, ...updates } : current);
    setError("");
    setSaved(false);
  }

  function changeChannel(channel: GrowthChannel, enabledChannel: boolean) {
    if (!profile) return;
    changeProfile({ channels: { ...profile.channels, [channel]: enabledChannel } });
  }

  function changeCadence(channel: GrowthChannel, value: number) {
    if (!profile) return;
    changeProfile({ cadence: { ...profile.cadence, [channel]: value } });
  }

  function changePillar(index: number, updates: Partial<GrowthPillar>) {
    if (!profile) return;
    changeProfile({
      pillars: profile.pillars.map((pillar, pillarIndex) => (
        pillarIndex === index ? { ...pillar, ...updates } : pillar
      )),
    });
  }

  function removePillar(index: number) {
    if (!profile || profile.pillars.length === 1) return;
    changeProfile({ pillars: profile.pillars.filter((_, pillarIndex) => pillarIndex !== index) });
  }

  function addPillar() {
    if (!profile) return;
    changeProfile({
      pillars: [...profile.pillars, {
        id: createGrowthPillarId(profile.pillars),
        label: "",
        weight: 0,
        description: "",
      }],
    });
  }

  function changePostingWindow(index: number, updates: Partial<GrowthPostingWindow>) {
    if (!profile) return;
    changeProfile({
      postingWindows: profile.postingWindows.map((window, windowIndex) => (
        windowIndex === index ? { ...window, ...updates } : window
      )),
    });
  }

  function removePostingWindow(index: number) {
    if (!profile) return;
    changeProfile({
      postingWindows: profile.postingWindows.filter((_, windowIndex) => windowIndex !== index),
    });
  }

  function addPostingWindow() {
    if (!profile) return;
    changeProfile({ postingWindows: [...profile.postingWindows, { weekday: 1, hour: 9 }] });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setError("");
    setSaved(false);
    let normalized: GrowthProfileInput;
    try {
      normalized = normalizeGrowthProfileInput({
        ...profile,
        hashtags: hashtags.split(/[\n,]/),
      });
    } catch (cause) {
      const message = cause instanceof GrowthProfileValidationError
        ? cause.message
        : t("growth.libraryInvalidProfile");
      setError(t("growth.libraryValidationError", { message }));
      return;
    }

    setSaving(true);
    try {
      const result = await updateGrowthProfile(repository, normalized);
      setProfile(editableProfile(result));
      setHashtags(result.hashtags.join(", "));
      setSaved(true);
    } catch (cause) {
      setError(t("growth.librarySaveError", { message: (cause as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="growth-library">
      <header className="growth-library-hero">
        <span>{t("growth.libraryEyebrow")}</span>
        <h1>{t("growth.libraryTitle")}</h1>
        <p>{t("growth.libraryDescription", { repository })}</p>
      </header>

      <GrowthAssetLibrary accountId={accountId} enabled={enabled} repository={repository} />

      <section className="growth-library-card growth-library-sources">
        <div className="growth-library-section-heading">
          <div>
            <span>{t("growth.librarySourcesEyebrow")}</span>
            <h2>{t("growth.librarySourcesTitle")}</h2>
            <p>{t("growth.librarySourcesDescription")}</p>
          </div>
          <RepositoryContentSources repository={repository} repos={repos} />
        </div>
      </section>

      {loading ? <div className="growth-library-state" role="status">{t("growth.libraryLoading")}</div> : null}
      {error ? <div className="growth-library-error" role="alert">{error}</div> : null}

      {profile ? (
        <form className="growth-library-form" onSubmit={(event) => void submit(event)}>
          <section className="growth-library-card">
            <div className="growth-library-section-heading">
              <div>
                <span>{t("growth.libraryProfileEyebrow")}</span>
                <h2>{t("growth.libraryProfileTitle")}</h2>
                <p>{t("growth.libraryProfileDescription")}</p>
              </div>
            </div>
            <div className="growth-library-fields growth-library-profile-fields">
              <label>
                {t("growth.libraryLanguage")}
                <input value={profile.language} required onChange={(event) => changeProfile({ language: event.target.value })} />
              </label>
              <label>
                {t("growth.libraryTimezone")}
                <input value={profile.timezone} required placeholder={t("growth.libraryTimezonePlaceholder")} onChange={(event) => changeProfile({ timezone: event.target.value })} />
              </label>
              <label className="growth-library-color-field">
                {t("growth.libraryColor")}
                <span><input type="color" value={profile.color} onChange={(event) => changeProfile({ color: event.target.value })} /><code>{profile.color.toUpperCase()}</code></span>
              </label>
              <label>
                {t("growth.libraryVoice")}
                <input value={profile.voice} onChange={(event) => changeProfile({ voice: event.target.value })} />
              </label>
              <label className="growth-library-wide-field">
                {t("growth.libraryAudience")}
                <textarea rows={2} value={profile.audience} onChange={(event) => changeProfile({ audience: event.target.value })} />
              </label>
              <label className="growth-library-wide-field">
                {t("growth.libraryHashtags")}
                <input value={hashtags} placeholder={t("growth.libraryHashtagsPlaceholder")} onChange={(event) => { setHashtags(event.target.value); setError(""); setSaved(false); }} />
                <small>{t("growth.libraryHashtagsHint")}</small>
              </label>
              <label className="growth-library-wide-field">
                {t("growth.libraryAvoid")}
                <textarea rows={3} value={profile.avoid} onChange={(event) => changeProfile({ avoid: event.target.value })} />
              </label>
            </div>
          </section>

          <section className="growth-library-card">
            <div className="growth-library-section-heading">
              <div>
                <span>{t("growth.libraryChannelsEyebrow")}</span>
                <h2>{t("growth.libraryChannelsTitle")}</h2>
                <p>{t("growth.libraryChannelsDescription")}</p>
              </div>
            </div>
            <div className="growth-library-channel-grid">
              {GROWTH_CHANNELS.map((channel) => (
                <label className="growth-library-channel" key={channel}>
                  <input type="checkbox" checked={profile.channels[channel]} onChange={(event) => changeChannel(channel, event.target.checked)} />
                  <span>{t(`growth.channel.${channel}`)}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="growth-library-card">
            <div className="growth-library-section-heading">
              <div>
                <span>{t("growth.libraryCadenceEyebrow")}</span>
                <h2>{t("growth.libraryCadenceTitle")}</h2>
                <p>{t("growth.libraryCadenceDescription")}</p>
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
                    value={profile.cadence[channel]}
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
                <h2>{t("growth.libraryPillarsTitle")}</h2>
                <p>{t("growth.libraryPillarsDescription")}</p>
              </div>
              <button className="btn ghost" type="button" onClick={addPillar}>{t("growth.libraryAddPillar")}</button>
            </div>
            <div className="growth-library-pillar-list">
              {profile.pillars.map((pillar, index) => (
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
                    disabled={profile.pillars.length === 1}
                    aria-label={t("growth.libraryRemovePillar", { label: pillar.label || pillar.id })}
                    onClick={() => removePillar(index)}
                  >×</button>
                </div>
              ))}
            </div>
          </section>

          <section className="growth-library-card">
            <div className="growth-library-section-heading">
              <div>
                <span>{t("growth.libraryPostingEyebrow")}</span>
                <h2>{t("growth.libraryPostingTitle")}</h2>
                <p>{t("growth.libraryPostingDescription")}</p>
              </div>
              <button className="btn ghost" type="button" onClick={addPostingWindow}>{t("growth.libraryAddPostingWindow")}</button>
            </div>
            {profile.postingWindows.length ? (
              <div className="growth-library-window-list">
                {profile.postingWindows.map((window, index) => (
                  <div className="growth-library-window" key={index}>
                    <label>
                      {t("growth.libraryWeekday")}
                      <select value={window.weekday} onChange={(event) => changePostingWindow(index, { weekday: Number(event.target.value) })}>
                        {WEEKDAYS.map((weekday) => <option key={weekday} value={weekday}>{t(`growth.weekday.${weekday}`)}</option>)}
                      </select>
                    </label>
                    <label>
                      {t("growth.libraryHour")}
                      <input type="number" min={0} max={23} step={1} value={window.hour} onChange={(event) => changePostingWindow(index, { hour: event.target.valueAsNumber })} />
                    </label>
                    <button className="btn ghost danger" type="button" onClick={() => removePostingWindow(index)}>{t("common.remove")}</button>
                  </div>
                ))}
              </div>
            ) : <p className="growth-library-empty-note">{t("growth.libraryPostingEmpty")}</p>}
          </section>

          <footer className="growth-library-savebar">
            <span role="status">{saved ? t("growth.librarySaved") : ""}</span>
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? t("growth.librarySaving") : t("growth.librarySave")}
            </button>
          </footer>
        </form>
      ) : null}
    </div>
  );
}
