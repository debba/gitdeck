import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildGrowthCalendarExportUrl,
  fetchGrowthUnifiedCalendar,
  patchGrowthContentItem,
} from "../../../api/growth";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";
import type { GrowthContentItem, GrowthUnifiedCalendar } from "../../../types/growth";
import {
  buildGrowthCalendarMonth,
  buildGrowthCalendarWeek,
  normalizeCalendarDate,
  rescheduleGrowthCalendarItem,
  shiftCalendarMonth,
  shiftCalendarWeek,
} from "../../../utils/growth/calendar";
import {
  EMPTY_GROWTH_UNIFIED_CALENDAR_FILTERS,
  filterGrowthUnifiedCalendar,
  growthUnifiedCalendarFilterOptions,
  growthUnifiedCalendarUtcRange,
  readGrowthUnifiedCalendarFilters,
  writeGrowthUnifiedCalendarFilters,
  type GrowthUnifiedCalendarFilterState,
} from "../../../utils/growth/unifiedCalendar";
import { ContentItemDrawer } from "../ContentItemDrawer";
import { GrowthCalendarMonth } from "./GrowthCalendarMonth";
import { GrowthCalendarWeek } from "./GrowthCalendarWeek";
import { GrowthMultiPlanManager } from "./GrowthMultiPlanManager";

interface GrowthUnifiedCalendarProps {
  accountId: string | null;
  enabled: boolean;
}

type UnifiedCalendarView = "month" | "week";

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function calendarQuery(
  view: UnifiedCalendarView,
  date: string,
  filters: GrowthUnifiedCalendarFilterState,
): URLSearchParams {
  const query = new URLSearchParams({ view, date });
  return writeGrowthUnifiedCalendarFilters(query, filters);
}

export function GrowthUnifiedCalendar({ accountId, enabled }: GrowthUnifiedCalendarProps) {
  const { language, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const rawView = query.get("view");
  const rawDate = query.get("date");
  const calendarView: UnifiedCalendarView = rawView === "week" ? "week" : "month";
  const selectedDate = normalizeCalendarDate(rawDate, utcToday());
  const filters = readGrowthUnifiedCalendarFilters(location.search);
  const grid = useMemo(
    () => calendarView === "month"
      ? buildGrowthCalendarMonth(selectedDate)
      : buildGrowthCalendarWeek(selectedDate),
    [calendarView, selectedDate],
  );
  const requestRange = useMemo(() => growthUnifiedCalendarUtcRange(grid), [grid]);
  const requestKey = `${accountId ?? ""}:${requestRange.scheduledFrom}:${requestRange.scheduledTo}`;
  const [reloadToken, setReloadToken] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    calendar: GrowthUnifiedCalendar;
  } | null>(null);
  const calendar = loaded?.key === requestKey ? loaded.calendar : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rescheduleError, setRescheduleError] = useState("");
  const [reschedulingIds, setReschedulingIds] = useState<Set<string>>(() => new Set());
  const [selectedItem, setSelectedItem] = useState<GrowthContentItem | null>(null);

  useEffect(() => {
    const canonical = calendarQuery(calendarView, selectedDate, filters).toString();
    if (location.search.slice(1) !== canonical) {
      navigate(`${location.pathname}?${canonical}`, { replace: true });
    }
  }, [calendarView, filters.channel, filters.pillar, filters.repository, filters.status, location.pathname, location.search, navigate, selectedDate]);

  useEffect(() => {
    setSelectedItem(null);
    setError("");
    setRescheduleError("");
    setReschedulingIds(new Set());
    if (!enabled || !accountId) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void fetchGrowthUnifiedCalendar(requestRange, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, calendar: result });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setError((cause as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountId, enabled, reloadToken, requestKey, requestRange]);

  const filterOptions = useMemo(
    () => calendar ? growthUnifiedCalendarFilterOptions(calendar) : {
      repositories: [],
      channels: [],
      pillars: [],
      statuses: [],
    },
    [calendar],
  );
  const visibleCalendar = useMemo(
    () => calendar
      ? filterGrowthUnifiedCalendar(calendar, filters, grid)
      : { itemsByDate: new Map(), itemPresentations: new Map(), itemCount: 0 },
    [calendar, filters.channel, filters.pillar, filters.repository, filters.status, grid],
  );
  const postingHours = useMemo(
    () => [...new Set(calendar?.repositories.flatMap((repository) => (
      repository.postingWindows.map((window) => window.hour)
    )) ?? [])].sort((left, right) => left - right),
    [calendar],
  );
  const visibleDates = useMemo(() => new Set(grid.days.map(({ date }) => date)), [grid]);
  const hasFilters = Object.values(filters).some(Boolean);
  const headingFormatter = new Intl.DateTimeFormat(language, {
    month: calendarView === "month" ? "long" : "short",
    day: calendarView === "week" ? "numeric" : undefined,
    year: "numeric",
    timeZone: "UTC",
  });
  const headingLabel = calendarView === "month"
    ? headingFormatter.format(new Date(`${(grid as ReturnType<typeof buildGrowthCalendarMonth>).monthStart}T12:00:00.000Z`))
    : `${headingFormatter.format(new Date(`${grid.rangeStart}T12:00:00.000Z`))} – ${headingFormatter.format(new Date(`${grid.rangeEnd}T12:00:00.000Z`))}`;
  const exportUrl = buildGrowthCalendarExportUrl({
    from: requestRange.scheduledFrom,
    to: requestRange.scheduledTo,
  });

  function navigateCalendar(
    date: string,
    view: UnifiedCalendarView = calendarView,
    nextFilters: GrowthUnifiedCalendarFilterState = filters,
  ) {
    navigate(`${location.pathname}?${calendarQuery(view, date, nextFilters).toString()}`);
  }

  function changeFilter(key: keyof GrowthUnifiedCalendarFilterState, value: string) {
    navigateCalendar(selectedDate, calendarView, {
      ...filters,
      [key]: value,
    } as GrowthUnifiedCalendarFilterState);
  }

  function replaceItem(item: GrowthContentItem) {
    setLoaded((current) => current?.key === requestKey ? {
      ...current,
      calendar: {
        repositories: current.calendar.repositories.map((repository) => (
          repository.repository === item.repository
            ? {
                ...repository,
                contentItems: repository.contentItems.map((entry) => entry.id === item.id ? item : entry),
              }
            : repository
        )),
      },
    } : current);
    setSelectedItem((current) => current?.id === item.id ? item : current);
  }

  async function rescheduleItem(item: GrowthContentItem, targetDate: string) {
    if (!calendar || !visibleDates.has(targetDate) || reschedulingIds.has(item.id)) return;
    const repository = calendar.repositories.find((entry) => entry.repository === item.repository);
    if (!repository) return;
    let optimistic: GrowthContentItem;
    try {
      optimistic = rescheduleGrowthCalendarItem(item, targetDate, repository.timezone);
    } catch {
      return;
    }
    if (optimistic.scheduledFor === item.scheduledFor) return;

    setRescheduleError("");
    setReschedulingIds((current) => new Set(current).add(item.id));
    replaceItem(optimistic);
    try {
      replaceItem(await patchGrowthContentItem(item.id, {
        scheduledFor: optimistic.scheduledFor,
        status: item.status,
      }));
    } catch (cause) {
      replaceItem(item);
      setRescheduleError((cause as Error).message);
    } finally {
      setReschedulingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  function dropItem(itemId: string, targetDate: string) {
    const item = calendar?.repositories
      .flatMap((repository) => repository.contentItems)
      .find((entry) => entry.id === itemId);
    if (item) void rescheduleItem(item, targetDate);
  }

  return (
    <section className="growth-calendar growth-unified-calendar" aria-busy={loading}>
      <header className="growth-calendar-hero">
        <div>
          <span>{t("growth.unifiedCalendarEyebrow")}</span>
          <h1>{t("growth.unifiedCalendar")}</h1>
          <p>{t("growth.unifiedCalendarDescription")}</p>
        </div>
        {calendar ? (
          <div className="growth-unified-calendar-count">
            {t("growth.unifiedCalendarRepositoryCount", { count: calendar.repositories.length })}
          </div>
        ) : null}
      </header>

      <GrowthMultiPlanManager
        accountId={accountId}
        enabled={enabled}
        repositories={calendar?.repositories.map(({ repository }) => repository) ?? []}
        onGenerated={() => setReloadToken((current) => current + 1)}
      />

      <div className="growth-unified-calendar-filters" role="group" aria-label={t("growth.unifiedCalendarFilters")}>
        <label>
          <span>{t("growth.unifiedCalendarFilterRepository")}</span>
          <select value={filters.repository} onChange={(event) => changeFilter("repository", event.target.value)}>
            <option value="">{t("growth.unifiedCalendarAllRepositories")}</option>
            {filterOptions.repositories.map((repository) => <option key={repository} value={repository}>{repository}</option>)}
          </select>
        </label>
        <label>
          <span>{t("growth.unifiedCalendarFilterChannel")}</span>
          <select value={filters.channel} onChange={(event) => changeFilter("channel", event.target.value)}>
            <option value="">{t("growth.unifiedCalendarAllChannels")}</option>
            {filterOptions.channels.map((channel) => (
              <option key={channel} value={channel}>{t(`growth.channel.${channel}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("growth.unifiedCalendarFilterPillar")}</span>
          <select value={filters.pillar} onChange={(event) => changeFilter("pillar", event.target.value)}>
            <option value="">{t("growth.unifiedCalendarAllPillars")}</option>
            {filterOptions.pillars.map((pillar) => (
              <option key={pillar.value} value={pillar.value}>
                {t("growth.unifiedCalendarPillarOption", { label: pillar.label, repository: pillar.repository })}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("growth.unifiedCalendarFilterStatus")}</span>
          <select value={filters.status} onChange={(event) => changeFilter("status", event.target.value)}>
            <option value="">{t("growth.unifiedCalendarAllStatuses")}</option>
            {filterOptions.statuses.map((status) => (
              <option key={status} value={status}>{t(`growth.status.${status}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
        <button
          className="btn ghost"
          type="button"
          disabled={!hasFilters}
          onClick={() => navigateCalendar(selectedDate, calendarView, EMPTY_GROWTH_UNIFIED_CALENDAR_FILTERS)}
        >
          {t("growth.unifiedCalendarClearFilters")}
        </button>
      </div>

      <div className="growth-calendar-toolbar">
        <div className="growth-calendar-toolbar-actions">
          <div className="growth-calendar-view-switch" role="group" aria-label={t("growth.calendarViewLabel")}>
            <button className={`btn ghost${calendarView === "month" ? " active" : ""}`} type="button" aria-pressed={calendarView === "month"} onClick={() => navigateCalendar(selectedDate, "month")}>{t("growth.calendarMonthView")}</button>
            <button className={`btn ghost${calendarView === "week" ? " active" : ""}`} type="button" aria-pressed={calendarView === "week"} onClick={() => navigateCalendar(selectedDate, "week")}>{t("growth.calendarWeekView")}</button>
          </div>
          <div className="growth-calendar-navigation">
            <button className="btn ghost" type="button" onClick={() => navigateCalendar(calendarView === "month" ? shiftCalendarMonth(selectedDate, -1) : shiftCalendarWeek(selectedDate, -1))}>
              <span aria-hidden="true">←</span> {t(calendarView === "month" ? "growth.calendarPreviousMonth" : "growth.calendarPreviousWeek")}
            </button>
            <button className="btn ghost" type="button" onClick={() => navigateCalendar(utcToday())}>{t("growth.calendarToday")}</button>
            <button className="btn ghost" type="button" onClick={() => navigateCalendar(calendarView === "month" ? shiftCalendarMonth(selectedDate, 1) : shiftCalendarWeek(selectedDate, 1))}>
              {t(calendarView === "month" ? "growth.calendarNextMonth" : "growth.calendarNextWeek")} <span aria-hidden="true">→</span>
            </button>
            <a className="btn ghost" href={exportUrl} download="gitdeck-growth-calendar.ics">{t("growth.calendarExport")}</a>
          </div>
        </div>
        <h2>{headingLabel}</h2>
      </div>

      {loading ? <div className="growth-calendar-state" role="status">{t("growth.unifiedCalendarLoading")}</div> : null}
      {error ? <div className="growth-calendar-error" role="alert">{t("growth.unifiedCalendarError", { message: error })}</div> : null}
      {rescheduleError ? <div className="growth-calendar-error" role="alert">{t("growth.calendarRescheduleError", { message: rescheduleError })}</div> : null}
      {!loading && !error && calendar && visibleCalendar.itemCount === 0 ? (
        <div className="growth-calendar-empty">
          <strong>{t(hasFilters ? "growth.unifiedCalendarNoMatchesTitle" : "growth.unifiedCalendarEmptyTitle")}</strong>
          <p>{t(hasFilters ? "growth.unifiedCalendarNoMatchesDescription" : "growth.unifiedCalendarEmptyDescription")}</p>
        </div>
      ) : null}

      {calendar && calendarView === "month" ? (
        <GrowthCalendarMonth
          grid={grid as ReturnType<typeof buildGrowthCalendarMonth>}
          itemsByDate={visibleCalendar.itemsByDate}
          timezone="UTC"
          color="var(--accent)"
          pillarLabels={new Map()}
          itemPresentations={visibleCalendar.itemPresentations}
          reschedulingIds={reschedulingIds}
          onOpenItem={setSelectedItem}
          onRescheduleItem={(item, date) => void rescheduleItem(item, date)}
          onDropItem={dropItem}
        />
      ) : null}

      {calendar && calendarView === "week" ? (
        <GrowthCalendarWeek
          grid={grid as ReturnType<typeof buildGrowthCalendarWeek>}
          itemsByDate={visibleCalendar.itemsByDate}
          timezone="UTC"
          color="var(--accent)"
          postingHours={postingHours}
          pillarLabels={new Map()}
          itemPresentations={visibleCalendar.itemPresentations}
          reschedulingIds={reschedulingIds}
          onOpenItem={setSelectedItem}
          onRescheduleItem={(item, date) => void rescheduleItem(item, date)}
          onDropItem={dropItem}
        />
      ) : null}

      {selectedItem ? (
        <ContentItemDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdate={replaceItem}
        />
      ) : null}
    </section>
  );
}
