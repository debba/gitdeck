import type { CSSProperties, DragEvent } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";
import type { GrowthContentItem } from "../../../types/growth";
import type { GrowthCalendarWeekGrid } from "../../../utils/growth/calendar";
import type { GrowthUnifiedCalendarItemPresentation } from "../../../utils/growth/unifiedCalendar";
import { GROWTH_CALENDAR_DRAG_TYPE, GrowthCalendarItem } from "./GrowthCalendarItem";

interface GrowthCalendarWeekProps {
  grid: GrowthCalendarWeekGrid;
  itemsByDate: ReadonlyMap<string, GrowthContentItem[]>;
  timezone: string;
  color: string;
  postingHours: readonly number[];
  pillarLabels: ReadonlyMap<string, string>;
  itemPresentations?: ReadonlyMap<string, GrowthUnifiedCalendarItemPresentation>;
  reschedulingIds: ReadonlySet<string>;
  onOpenItem: (item: GrowthContentItem) => void;
  onRescheduleItem: (item: GrowthContentItem, targetDate: string) => void;
  onDropItem: (itemId: string, targetDate: string) => void;
}

export function GrowthCalendarWeek({
  grid,
  itemsByDate,
  timezone,
  color,
  postingHours,
  pillarLabels,
  itemPresentations,
  reschedulingIds,
  onOpenItem,
  onRescheduleItem,
  onDropItem,
}: GrowthCalendarWeekProps) {
  const { language, t } = useI18n();
  const dateFormatter = new Intl.DateTimeFormat(language, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const shortDateFormatter = new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const hourFormatter = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
  const rangeLabel = `${shortDateFormatter.format(new Date(`${grid.rangeStart}T12:00:00.000Z`))} – ${shortDateFormatter.format(new Date(`${grid.rangeEnd}T12:00:00.000Z`))}`;
  const calendarStyle = {
    "--growth-calendar-color": color,
    "--growth-calendar-guide-count": Math.max(postingHours.length, 1),
  } as CSSProperties;

  function dropItem(event: DragEvent<HTMLElement>, targetDate: string) {
    event.preventDefault();
    const itemId = event.dataTransfer.getData(GROWTH_CALENDAR_DRAG_TYPE);
    if (itemId) onDropItem(itemId, targetDate);
  }

  return (
    <section className="growth-calendar-week" aria-label={rangeLabel} style={calendarStyle}>
      <div className="growth-calendar-scroll">
        <div className="growth-calendar-week-head">
          <span className="growth-calendar-week-guide-title">{t("growth.calendarPostingHours")}</span>
          {grid.days.map((day, index) => (
            <header key={day.date}>
              <span>{t(`growth.weekday.${index + 1}` as TranslationKey)}</span>
              <time dateTime={day.date}>{shortDateFormatter.format(new Date(`${day.date}T12:00:00.000Z`))}</time>
            </header>
          ))}
        </div>
        <div className="growth-calendar-week-body">
          <aside className="growth-calendar-week-hours" aria-label={t("growth.calendarPostingHours")}>
            {postingHours.length ? postingHours.map((hour) => (
              <time key={hour} dateTime={`${String(hour).padStart(2, "0")}:00`}>
                {hourFormatter.format(new Date(Date.UTC(2026, 0, 1, hour)))}
              </time>
            )) : <span>—</span>}
          </aside>
          <div className="growth-calendar-week-grid">
            {grid.days.map((day) => {
              const formattedDate = dateFormatter.format(new Date(`${day.date}T12:00:00.000Z`));
              return (
                <section
                  className="growth-calendar-week-day"
                  key={day.date}
                  aria-label={formattedDate}
                  data-calendar-date={day.date}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropItem(event, day.date)}
                >
                  <div className="growth-calendar-week-guides" aria-hidden="true">
                    {Array.from({ length: Math.max(postingHours.length, 1) }, (_, index) => <i key={index} />)}
                  </div>
                  <div className="growth-calendar-day-items">
                    {(itemsByDate.get(day.date) ?? []).map((item) => {
                      const presentation = itemPresentations?.get(item.id);
                      return (
                        <GrowthCalendarItem
                          key={item.id}
                          item={item}
                          date={day.date}
                          formattedDate={formattedDate}
                          timezone={presentation?.timezone ?? timezone}
                          color={presentation?.color ?? color}
                          pillarLabel={presentation?.pillarLabel ?? (item.pillar ? pillarLabels.get(item.pillar) ?? item.pillar : "")}
                          repository={presentation?.repository}
                          rescheduling={reschedulingIds.has(item.id)}
                          onOpen={onOpenItem}
                          onReschedule={onRescheduleItem}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
