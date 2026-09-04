import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchAiSettings, fetchGoalProposals } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";
import type { GoalProposal, GoalSuggestion, RepositoryGoal } from "../../types/goals";
import { formatRelativeTime } from "../../utils/format";
import { formatXThreadForCopy } from "../../utils/goals";
import { socialCharacterCount } from "../../utils/socialProposals";
import { CloseIcon, GoalIcon } from "../common/Icons";
import { Markdown } from "../common/Markdown";

interface GoalProposalsModalProps {
  goal: RepositoryGoal;
  suggestion: GoalSuggestion;
  suggestionIndex: number;
  onClose: () => void;
  onOpenPreferences: () => void;
  /** Called with the fresh proposals so the parent can keep its goal list in sync. */
  onProposals?: (proposals: GoalProposal[], generatedAt: string) => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; proposals: GoalProposal[]; generatedAt: string }
  | { kind: "no-ai" }
  | { kind: "error"; message: string };

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      className={`btn ghost goal-proposal-copy ${copied ? "copied" : ""}`}
      type="button"
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)); }}
    >
      {copied ? t("common.copied") : label ?? t("common.copy")}
    </button>
  );
}

/**
 * Shows AI-drafted deliverables for one recommended action of a goal. Drafts
 * are cached server-side per suggestion; "Regenerate" asks for new ones.
 */
export function GoalProposalsModal({ goal, suggestion, suggestionIndex, onClose, onOpenPreferences, onProposals }: GoalProposalsModalProps) {
  const { t, language } = useI18n();
  const initialState = (): LoadState => suggestion.proposals?.length
    ? { kind: "ready", proposals: suggestion.proposals, generatedAt: suggestion.proposalsGeneratedAt ?? "" }
    : goal.aiEnabled ? { kind: "idle" } : { kind: "no-ai" };
  const [state, setState] = useState<LoadState>(initialState);
  const [refreshing, setRefreshing] = useState(false);
  const [modelLabel, setModelLabel] = useState("");

  async function load(refresh: boolean) {
    if (refresh && state.kind === "ready") setRefreshing(true);
    else setState({ kind: "loading" });
    try {
      const result = await fetchGoalProposals(goal.id, suggestionIndex, refresh);
      setState({ kind: "ready", proposals: result.proposals, generatedAt: result.generatedAt });
      onProposals?.(result.proposals, result.generatedAt);
    } catch (error) {
      const message = (error as Error).message;
      setState(/not configured/i.test(message) ? { kind: "no-ai" } : { kind: "error", message });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    setState(initialState());
    // Reset the modal without contacting the AI when the selected action changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal.id, suggestionIndex]);

  useEffect(() => {
    let active = true;
    if (!goal.aiEnabled) {
      setModelLabel("");
      return () => { active = false; };
    }
    void fetchAiSettings().then(({ settings }) => {
      if (!active) return;
      const model = settings.model.value;
      setModelLabel(model ? `${settings.provider.value} · ${model}` : settings.provider.value);
    }).catch(() => {});
    return () => { active = false; };
  }, [goal.aiEnabled]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal goal-proposals-modal" role="dialog" aria-modal="true" aria-labelledby="goal-proposals-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-icon repository" aria-hidden="true"><GoalIcon /></span>
            <div style={{ minWidth: 0 }}>
              <div className="kind">
                {t("goals.proposalsKind")} · <span className="goal-proposals-category">{suggestion.category}</span>
                {modelLabel ? <span className="goal-proposals-model" title={t("preferences.ai.model")}> · AI {modelLabel}</span> : null}
              </div>
              <h3 id="goal-proposals-title">{suggestion.title}</h3>
            </div>
          </div>
          <button className="modal-close" type="button" aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
        </header>

        <div className="modal-body goal-proposals-body">
          <p className="goal-proposals-intro">{t("goals.proposalsIntro", { repo: goal.repository })}</p>
          <blockquote className="goal-proposals-action">{suggestion.action}</blockquote>

          {state.kind === "idle" ? (
            <div className="goal-proposals-start">
              <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3" /></svg></span>
              <div><strong>{t("goals.proposalsReadyTitle")}</strong><small>{t("goals.proposalsReadyText")}</small></div>
            </div>
          ) : null}

          {state.kind === "loading" ? (
            <div className="goal-proposals-loading" role="status">
              <span className="goal-proposals-spinner" aria-hidden="true" />
              {t("goals.proposalsLoading")}
            </div>
          ) : null}

          {state.kind === "no-ai" ? (
            <div className="goal-proposals-note">
              <p>{t("goals.proposalsNoAi")}</p>
              <button className="btn primary" type="button" onClick={onOpenPreferences}>{t("goals.proposalsOpenPreferences")}</button>
            </div>
          ) : null}

          {state.kind === "error" ? <div className="error">{state.message}</div> : null}

          {state.kind === "ready" ? (
            state.proposals.length ? (
              <div className={`goal-proposal-list ${refreshing ? "refreshing" : ""}`}>
                {state.proposals.map((proposal, index) => (
                  <article className="goal-proposal" key={`${proposal.title}-${index}`}>
                    <header className="goal-proposal-head">
                      <span className={`goal-proposal-format format-${proposal.format}`}>{t(`goals.proposalFormat.${proposal.format}`)}</span>
                      <div className="goal-proposal-copy-block">
                        <strong>{proposal.title}</strong>
                        {proposal.summary ? <small>{proposal.summary}</small> : null}
                      </div>
                      <CopyButton
                        text={proposal.format === "x-thread" ? formatXThreadForCopy(proposal) : proposal.content}
                        label={proposal.format === "x-thread" ? t("goals.copyThread") : undefined}
                      />
                    </header>
                    {proposal.format === "x-thread" && proposal.threadPosts?.length ? (
                      <div className="goal-x-thread">
                        {proposal.threadPosts.map((post, postIndex) => (
                          <section className="goal-x-post" key={`${postIndex}-${post.slice(0, 24)}`}>
                            <div className="goal-x-post-rail" aria-hidden="true">
                              <span className="goal-x-avatar">X</span>
                              {postIndex < proposal.threadPosts!.length - 1 ? <i /> : null}
                            </div>
                            <div className="goal-x-post-body">
                              <header>
                                <strong>{goal.repository}</strong>
                                <span>{postIndex + 1}/{proposal.threadPosts!.length}</span>
                                <CopyButton text={post} label={t("goals.copyPost", { count: postIndex + 1 })} />
                              </header>
                              <div className="goal-x-post-content">{post}</div>
                              <small className={socialCharacterCount(post) > 280 ? "over-limit" : ""}>{socialCharacterCount(post)}/280</small>
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : <Markdown className="goal-proposal-content">{proposal.content}</Markdown>}
                    {proposal.mediaSuggestions?.length ? (
                      <div className="goal-proposal-media">
                        <strong>{t("goals.mediaTitle")}</strong>
                        <div>{proposal.mediaSuggestions.map((media) => (
                          <div className="goal-proposal-media-card" key={`${media.kind}:${media.sourceUrl}`}>
                            {media.kind === "image" ? (
                              <a className="goal-proposal-media-preview" href={media.sourceUrl} target="_blank" rel="noreferrer">
                                <img src={media.sourceUrl} alt={media.title} loading="lazy" referrerPolicy="no-referrer" />
                              </a>
                            ) : (
                              <video className="goal-proposal-media-preview" src={media.sourceUrl} controls preload="metadata">{t("goals.mediaVideo")}</video>
                            )}
                            <a className="goal-proposal-media-info" href={media.sourceUrl} target="_blank" rel="noreferrer">
                              <span>{media.kind === "image" ? t("goals.mediaImage") : t("goals.mediaVideo")}</span>
                              <b>{media.title}</b>
                              <small>{media.guidance}</small>
                            </a>
                          </div>
                        ))}</div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : <div className="empty"><p>{t("goals.proposalsEmpty")}</p></div>
          ) : null}
        </div>

        <footer className="modal-foot">
          <span className="modal-page">
            {state.kind === "ready" && state.generatedAt ? t("goals.proposalsGeneratedAt", { time: formatRelativeTime(state.generatedAt, Date.now(), language) }) : ""}
          </span>
          <div className="spacer" />
          {state.kind === "ready" ? (
            <button className="btn ghost" type="button" disabled={refreshing} onClick={() => void load(true)}>
              {refreshing ? t("common.loading") : t("goals.proposalsRegenerate")}
            </button>
          ) : null}
          <button className={state.kind === "idle" || state.kind === "error" ? "btn ghost" : "btn primary"} type="button" onClick={onClose}>{t("common.close")}</button>
          {state.kind === "idle" || state.kind === "error" ? (
            <button className="btn primary goal-proposals-generate" type="button" onClick={() => void load(state.kind === "error")}>
              {state.kind === "error" ? t("goals.proposalsRetry") : t("goals.proposalsGenerate")}
            </button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
