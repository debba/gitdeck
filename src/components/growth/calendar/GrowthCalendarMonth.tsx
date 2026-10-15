import type { CSSProperties, DragEvent } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";
import type { GrowthContentItem } from "../../../types/growth";
import type { GrowthCalendarMonthGrid } from "../../../utils/growth/calendar";
import type { GrowthUnifiedCalendarItemPresentation } from "../../../utils/growth/unifiedCalendar";
import { GROWTH_CALENDAR_DRAG_TYPE, GrowthCalendarItem } from "./GrowthCalendarItem";

interface GrowthCalendarMonthProps {
  grid: GrowthCalendarMonthGrid;
  itemsByDate: ReadonlyMap<string, GrowthContentItem[]>;
  timezone: string;
  color: string;
  pillarLabels: ReadonlyMap<string, string>;
  itemPresentations?: ReadonlyMap<string, GrowthUnifiedCalendarItemPresentation>;
  reschedulingIds: ReadonlySet<string>;
  onOpenItem: (item: GrowthContentItem) => void;
  onRescheduleItem: (item: GrowthContentItem, targetDate: string) => void;
  onDropItem: (itemId: string, targetDate: string) => void;
}

export function GrowthCalendarMonth({
  grid,
  itemsByDate,
  timezone,
  color,
  pillarLabels,
  itemPresentations,
  reschedulingIds,
  onOpenItem,
  onRescheduleItem,
  onDropItem,
}: GrowthCalendarMonthProps) {
  const { language, t } = useI18n();
  const monthLabel = new Intl.DateTimeFormat(language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${grid.monthStart}T12:00:00.000Z`));
  const dateFormatter = new Intl.DateTimeFormat(language, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => t(`growth.weekday.${index + 1}` as TranslationKey));
  const calendarStyle = { "--growth-calendar-color": color } as CSSProperties;

  function dropItem(event: DragEvent<HTMLElement>, targetDate: string) {
    event.preventDefault();
    const itemId = event.dataTransfer.getData(GROWTH_CALENDAR_DRAG_TYPE);
    if (itemId) onDropItem(itemId, targetDate);
  }

  return (
    <section className="growth-calendar-month" aria-label={monthLabel} style={calendarStyle}>
      <div className="growth-calendar-scroll">
        <div className="growth-calendar-weekdays" aria-hidden="true">
          {weekdayLabels.map((label) => <span key={label} title={label}>{label.slice(0, 3)}</span>)}
        </div>
        <div className="growth-calendar-grid">
          {grid.days.map((day) => {
            const dayItems = itemsByDate.get(day.date) ?? [];
            const formattedDate = dateFormatter.format(new Date(`${day.date}T12:00:00.000Z`));
            return (
              <section
                className={`growth-calendar-day${day.inCurrentMonth ? "" : " outside-month"}`}
                key={day.date}
                aria-label={formattedDate}
                data-calendar-date={day.date}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropItem(event, day.date)}
              >
                <header>
                  <time dateTime={day.date}>{day.dayOfMonth}</time>
                </header>
                <div className="growth-calendar-day-items">
                  {dayItems.map((item) => {
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
    </section>
  );
}
