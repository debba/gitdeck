import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";
import type { GrowthContentItem } from "../../../types/growth";
import { shiftCalendarDate } from "../../../utils/growth/calendar";

export const GROWTH_CALENDAR_DRAG_TYPE = "application/x-gitdeck-growth-content";

interface GrowthCalendarItemProps {
  item: GrowthContentItem;
  date: string;
  formattedDate: string;
  timezone: string;
  color: string;
  pillarLabel: string;
  repository?: string;
  rescheduling: boolean;
  onOpen: (item: GrowthContentItem) => void;
  onReschedule: (item: GrowthContentItem, targetDate: string) => void;
}

function itemTitle(item: GrowthContentItem): string {
  return item.title || item.angle || item.format;
}

export function GrowthCalendarItem({
  item,
  date,
  formattedDate,
  timezone,
  color,
  pillarLabel,
  repository,
  rescheduling,
  onOpen,
  onReschedule,
}: GrowthCalendarItemProps) {
  const { language, t } = useI18n();
  const title = itemTitle(item);
  const timeFormatter = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  });
  const style = { "--growth-calendar-color": color } as CSSProperties;

  function startDrag(event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(GROWTH_CALENDAR_DRAG_TYPE, item.id);
  }

  function handleKeyboardMove(event: KeyboardEvent<HTMLButtonElement>) {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const offset = event.key === "ArrowLeft" ? -1 : 1;
    onReschedule(item, shiftCalendarDate(date, offset));
  }

  return (
    <button
      className={`growth-calendar-item status-${item.status}${rescheduling ? " is-rescheduling" : ""}`}
      type="button"
      style={style}
      draggable={!rescheduling}
      aria-busy={rescheduling}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
      title={t("growth.calendarMoveHint")}
      onClick={() => onOpen(item)}
      onDragStart={startDrag}
      onKeyDown={handleKeyboardMove}
      aria-label={repository
        ? t("growth.unifiedCalendarOpenItem", { title, repository, date: formattedDate })
        : t("growth.calendarOpenItem", { title, date: formattedDate })}
    >
      <span className="growth-calendar-item-time">
        {timeFormatter.format(new Date(item.scheduledFor!))}
      </span>
      <strong>{title}</strong>
      <span className="growth-calendar-item-indicators">
        {repository ? (
          <small className="growth-calendar-item-repository" title={repository}>
            <i aria-hidden="true" />
            {repository}
          </small>
        ) : null}
        <small className="growth-calendar-item-channel">
          {t(`growth.channel.${item.channel}` as TranslationKey)}
        </small>
        <small>{t(`growth.status.${item.status}` as TranslationKey)}</small>
        {pillarLabel ? <small className="growth-calendar-item-pillar">{pillarLabel}</small> : null}
      </span>
    </button>
  );
}
