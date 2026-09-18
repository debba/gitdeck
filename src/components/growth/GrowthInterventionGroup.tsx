import { useId, useState, type ReactNode } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { GROWTH_INTERVENTION_STATUSES, type GrowthIntervention } from "../../types/growth";
import type { GrowthInterventionGroup as InterventionGroup } from "../../utils/growth/interventionGroups";

interface GrowthInterventionGroupProps {
  group: InterventionGroup;
  renderIntervention: (intervention: GrowthIntervention) => ReactNode;
}

export function GrowthInterventionGroup({ group, renderIntervention }: GrowthInterventionGroupProps) {
  const { t } = useI18n();
  const headingId = useId();
  const dismissedId = useId();
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const dismissed = group.interventions.filter((item) => item.status === "dismissed");

  return (
    <section className={`growth-intervention-group destination-${group.id}`} aria-labelledby={headingId}>
      <header>
        <h2 id={headingId}>{t(`growth.interventionsGroup.${group.id}`)}</h2>
        <span>{group.interventions.length}</span>
      </header>
      <p className="growth-intervention-group-description">{t(`growth.interventionsGroupDescription.${group.id}`)}</p>
      {group.interventions.length === 0 ? <p>{t("growth.interventionsGroupEmpty")}</p> : null}
      {GROWTH_INTERVENTION_STATUSES.filter((status) => status !== "dismissed").map((status) => {
        const entries = group.interventions.filter((item) => item.status === status);
        return entries.length ? (
          <section className={`growth-intervention-status-group status-${status}`} key={status}>
            <header><h3>{t(`growth.status.${status}`)}</h3><span>{entries.length}</span></header>
            <div className="growth-intervention-list">{entries.map(renderIntervention)}</div>
          </section>
        ) : null;
      })}
      {dismissed.length ? (
        <section className="growth-intervention-status-group status-dismissed">
          <button className="growth-intervention-group-toggle" type="button" aria-expanded={dismissedOpen}
            aria-controls={dismissedId} onClick={() => setDismissedOpen((open) => !open)}>
            <span><strong>{t("growth.status.dismissed")}</strong><small>{dismissed.length}</small></span>
            <span aria-hidden="true">{dismissedOpen ? "−" : "+"}</span>
          </button>
          <div id={dismissedId} hidden={!dismissedOpen}>
            {dismissedOpen ? <div className="growth-intervention-list">{dismissed.map(renderIntervention)}</div> : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}
