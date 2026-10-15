interface GoalsLoadingStateProps {
  label: string;
}

/** Layout-matched skeleton shown while the initial goals request is pending. */
export function GoalsLoadingState({ label }: GoalsLoadingStateProps) {
  return (
    <div className="goals-loading-state" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {[0, 1].map((card) => (
        <section className="goal-repository-card goal-skeleton-card" aria-hidden="true" key={card}>
          <header className="goal-repository-hero">
            <div className="goal-repository-identity">
              <span className="goal-skeleton goal-skeleton-avatar" />
              <div>
                <span className="goal-skeleton goal-skeleton-kicker" />
                <span className="goal-skeleton goal-skeleton-title" />
                <span className="goal-skeleton goal-skeleton-description" />
              </div>
            </div>
            <span className="goal-skeleton goal-skeleton-score" />
          </header>

          <div className="goal-track-grid">
            {[0, 1].map((track) => (
              <article className="goal-track goal-skeleton-track" key={track}>
                <span className="goal-skeleton goal-skeleton-metric" />
                <div className="goal-track-main">
                  <span className="goal-skeleton goal-skeleton-orbit" />
                  <div className="goal-skeleton-track-copy">
                    <span className="goal-skeleton goal-skeleton-value" />
                    <span className="goal-skeleton goal-skeleton-progress" />
                    <span className="goal-skeleton goal-skeleton-meta" />
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="goal-growth-studio goal-skeleton-studio">
            <span className="goal-skeleton goal-skeleton-studio-title" />
            <div className="goal-plan-grid">
              <span className="goal-skeleton goal-skeleton-plan" />
              <span className="goal-skeleton goal-skeleton-plan" />
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
