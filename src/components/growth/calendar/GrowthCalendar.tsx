import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildGrowthCalendarExportUrl,
  fetchGrowthContentItems,
  fetchGrowthProfile,
  patchGrowthContentItem,
} from "../../../api/growth";
import { useI18n } from "../../../i18n/I18nProvider";
import type { GrowthContentItem, GrowthProfile } from "../../../types/growth";
import {
  buildGrowthCalendarMonth,
  buildGrowthCalendarWeek,
  calendarDateInTimezone,
  groupGrowthCalendarItems,
  growthCalendarUtcRange,
  normalizeCalendarDate,
  rescheduleGrowthCalendarItem,
  shiftCalendarMonth,
  shiftCalendarWeek,
} from "../../../utils/growth/calendar";
import { ContentItemDrawer } from "../ContentItemDrawer";
import { GrowthCalendarMonth } from "./GrowthCalendarMonth";
import { GrowthCalendarWeek } from "./GrowthCalendarWeek";
import { GrowthPlanManager } from "./GrowthPlanManager";
import { GrowthQueue } from "./GrowthQueue";

interface GrowthCalendarProps {
  accountId: string | null;
  enabled: boolean;
  repository: string;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function GrowthCalendar({ accountId, enabled, repository }: GrowthCalendarProps) {
  const { language, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const search = new URLSearchParams(location.search);
  const rawDate = search.get("date");
  const view = search.get("view");
  const calendarView = view === "week" || view === "queue" ? view : "month";
  const [loadedProfile, setLoadedProfile] = useState<{
    accountId: string;
    repository: string;
    value: GrowthProfile;
  } | null>(null);
  const profile = loadedProfile?.accountId === accountId && loadedProfile.repository === repository
    ? loadedProfile.value
    : null;
  const [items, setItems] = useState<GrowthContentItem[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsLoadKey, setItemsLoadKey] = useState(0);
  const [error, setError] = useState("");
  const [rescheduleError, setRescheduleError] = useState("");
  const [reschedulingIds, setReschedulingIds] = useState<Set<string>>(() => new Set());
  const [selectedItem, setSelectedItem] = useState<GrowthContentItem | null>(null);

  const today = profile
    ? calendarDateInTimezone(new Date(), profile.timezone)
    : utcToday();
  const selectedDate = normalizeCalendarDate(rawDate, today);
  const grid = useMemo(
    () => calendarView === "month"
      ? buildGrowthCalendarMonth(selectedDate)
      : buildGrowthCalendarWeek(selectedDate),
    [calendarView, selectedDate],
  );

  useEffect(() => {
    setLoadedProfile(null);
    setItems([]);
    setSelectedItem(null);
    setError("");
    setRescheduleError("");
    setReschedulingIds(new Set());
    if (!enabled || !accountId || !repository) {
      setProfileLoading(false);
      return;
    }

    const controller = new AbortController();
    setProfileLoading(true);
    void fetchGrowthProfile(repository, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setLoadedProfile({ accountId, repository, value: result });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setError((cause as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false);
      });
    return () => controller.abort();
  }, [accountId, enabled, repository]);

  useEffect(() => {
    if (view === calendarView && rawDate === selectedDate) return;
    const canonical = new URLSearchParams();
    canonical.set("view", calendarView);
    canonical.set("date", selectedDate);
    navigate(`${location.pathname}?${canonical.toString()}`, { replace: true });
  }, [calendarView, location.pathname, navigate, rawDate, selectedDate, view]);

  useEffect(() => {
    setItems([]);
    setSelectedItem(null);
    if (!enabled || !accountId || !repository || !profile) {
      setItemsLoading(false);
      return;
    }

    const controller = new AbortController();
    const range = growthCalendarUtcRange(grid, profile.timezone);
    setItemsLoading(true);
    setError("");
    void fetchGrowthContentItems({ repository, ...range }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setItems(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && (cause as Error).name !== "AbortError") {
          setError((cause as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setItemsLoading(false);
      });
    return () => controller.abort();
  }, [accountId, enabled, grid, itemsLoadKey, profile, repository]);

  const itemsByDate = useMemo(
    () => groupGrowthCalendarItems(items, profile?.timezone ?? "UTC"),
    [items, profile?.timezone],
  );
  const visibleDates = useMemo(() => new Set(grid.days.map((day) => day.date)), [grid]);
  const visibleItemCount = grid.days.reduce((count, day) => count + (itemsByDate.get(day.date)?.length ?? 0), 0);
  const pillarLabels = useMemo(
    () => new Map(profile?.pillars.map((pillar) => [pillar.id, pillar.label]) ?? []),
    [profile?.pillars],
  );
  const headingFormatter = new Intl.DateTimeFormat(language, {
    month: calendarView === "month" ? "long" : "short",
    day: calendarView !== "month" ? "numeric" : undefined,
    year: "numeric",
    timeZone: "UTC",
  });
  const headingLabel = calendarView === "month"
    ? headingFormatter.format(new Date(`${(grid as ReturnType<typeof buildGrowthCalendarMonth>).monthStart}T12:00:00.000Z`))
    : `${headingFormatter.format(new Date(`${grid.rangeStart}T12:00:00.000Z`))} – ${headingFormatter.format(new Date(`${grid.rangeEnd}T12:00:00.000Z`))}`;
  const postingHours = useMemo(
    () => [...new Set(profile?.postingWindows.map((window) => window.hour) ?? [])].sort((left, right) => left - right),
    [profile?.postingWindows],
  );
  const loading = profileLoading || itemsLoading;
  const exportRange = profile ? growthCalendarUtcRange(grid, profile.timezone) : null;
  const exportUrl = exportRange ? buildGrowthCalendarExportUrl({
    repository,
    from: exportRange.scheduledFrom,
    to: exportRange.scheduledTo,
  }) : null;

  function navigateDate(date: string, nextView = calendarView) {
    const next = new URLSearchParams();
    next.set("view", nextView);
    next.set("date", date);
    navigate(`${location.pathname}?${next.toString()}`);
  }

  function updateItem(updated: GrowthContentItem) {
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedItem((current) => current?.id === updated.id ? updated : current);
  }

  async function rescheduleItem(item: GrowthContentItem, targetDate: string) {
    if (!profile || !visibleDates.has(targetDate) || reschedulingIds.has(item.id)) return;
    let optimistic: GrowthContentItem;
    try {
      optimistic = rescheduleGrowthCalendarItem(item, targetDate, profile.timezone);
    } catch {
      return;
    }
    if (optimistic.scheduledFor === item.scheduledFor) return;

    setRescheduleError("");
    setReschedulingIds((current) => new Set(current).add(item.id));
    setItems((current) => current.map((entry) => entry.id === item.id ? optimistic : entry));
    setSelectedItem((current) => current?.id === item.id ? optimistic : current);
    try {
      const updated = await patchGrowthContentItem(item.id, {
        scheduledFor: optimistic.scheduledFor,
        status: item.status,
      });
      setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
      setSelectedItem((current) => current?.id === item.id ? updated : current);
    } catch (cause) {
      setItems((current) => current.map((entry) => entry.id === item.id ? item : entry));
      setSelectedItem((current) => current?.id === item.id ? item : current);
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
    const item = items.find((entry) => entry.id === itemId);
    if (item) void rescheduleItem(item, targetDate);
  }

  return (
    <section className="growth-calendar" aria-busy={loading}>
      <header className="growth-calendar-hero">
        <div>
          <span>{t("growth.calendarEyebrow")}</span>
          <h1>{t("growth.calendarTitle")}</h1>
          <p>{t("growth.calendarDescription", { repository })}</p>
        </div>
        {profile ? (
          <div className="growth-calendar-timezone">
            <span aria-hidden="true" style={{ backgroundColor: profile.color }} />
            <small>{t("growth.calendarTimezone", { timezone: profile.timezone })}</small>
          </div>
        ) : null}
      </header>

      <GrowthPlanManager
        accountId={accountId}
        enabled={enabled}
        repository={repository}
        onContentItemsChange={() => setItemsLoadKey((key) => key + 1)}
      />

      <div className="growth-calendar-toolbar">
        <div className="growth-calendar-toolbar-actions">
          <div className="growth-calendar-view-switch" role="group" aria-label={t("growth.calendarViewLabel")}>
            <button className={`btn ghost${calendarView === "month" ? " active" : ""}`} type="button" aria-pressed={calendarView === "month"} onClick={() => navigateDate(selectedDate, "month")}>{t("growth.calendarMonthView")}</button>
            <button className={`btn ghost${calendarView === "week" ? " active" : ""}`} type="button" aria-pressed={calendarView === "week"} onClick={() => navigateDate(selectedDate, "week")}>{t("growth.calendarWeekView")}</button>
            <button className={`btn ghost${calendarView === "queue" ? " active" : ""}`} type="button" aria-pressed={calendarView === "queue"} onClick={() => navigateDate(selectedDate, "queue")}>{t("growth.calendarQueueView")}</button>
          </div>
          <div className="growth-calendar-navigation">
            <button className="btn ghost" type="button" disabled={!profile} onClick={() => navigateDate(calendarView !== "month" ? shiftCalendarWeek(selectedDate, -1) : shiftCalendarMonth(selectedDate, -1))}>
              <span aria-hidden="true">←</span> {t(calendarView !== "month" ? "growth.calendarPreviousWeek" : "growth.calendarPreviousMonth")}
            </button>
            <button className="btn ghost" type="button" disabled={!profile} onClick={() => navigateDate(today)}>{t("growth.calendarToday")}</button>
            <button className="btn ghost" type="button" disabled={!profile} onClick={() => navigateDate(calendarView !== "month" ? shiftCalendarWeek(selectedDate, 1) : shiftCalendarMonth(selectedDate, 1))}>
              {t(calendarView !== "month" ? "growth.calendarNextWeek" : "growth.calendarNextMonth")} <span aria-hidden="true">→</span>
            </button>
            {exportUrl ? (
              <a className="btn ghost" href={exportUrl} download="gitdeck-growth-calendar.ics">
                {t("growth.calendarExport")}
              </a>
            ) : null}
          </div>
        </div>
        <h2>{headingLabel}</h2>
      </div>

      {calendarView !== "queue" && loading ? <div className="growth-calendar-state" role="status">{t("growth.calendarLoading")}</div> : null}
      {calendarView !== "queue" && error ? <div className="growth-calendar-error" role="alert">{t("growth.calendarError", { message: error })}</div> : null}
      {rescheduleError ? <div className="growth-calendar-error" role="alert">{t("growth.calendarRescheduleError", { message: rescheduleError })}</div> : null}
      {calendarView !== "queue" && !loading && !error && profile && visibleItemCount === 0 ? (
        <div className="growth-calendar-empty">
          <strong>{t(calendarView === "week" ? "growth.calendarEmptyWeekTitle" : "growth.calendarEmptyTitle")}</strong>
          <p>{t("growth.calendarEmptyDescription")}</p>
        </div>
      ) : null}

      {profile && calendarView === "month" ? (
        <GrowthCalendarMonth
          grid={grid as ReturnType<typeof buildGrowthCalendarMonth>}
          itemsByDate={itemsByDate}
          timezone={profile.timezone}
          color={profile.color}
          pillarLabels={pillarLabels}
          reschedulingIds={reschedulingIds}
          onOpenItem={setSelectedItem}
          onRescheduleItem={(item, date) => void rescheduleItem(item, date)}
          onDropItem={dropItem}
        />
      ) : null}

      {profile && calendarView === "week" ? (
        <GrowthCalendarWeek
          grid={grid as ReturnType<typeof buildGrowthCalendarWeek>}
          itemsByDate={itemsByDate}
          timezone={profile.timezone}
          color={profile.color}
          postingHours={postingHours}
          pillarLabels={pillarLabels}
          reschedulingIds={reschedulingIds}
          onOpenItem={setSelectedItem}
          onRescheduleItem={(item, date) => void rescheduleItem(item, date)}
          onDropItem={dropItem}
        />
      ) : null}

      {calendarView === "queue" ? (
        <GrowthQueue
          items={items}
          week={grid as ReturnType<typeof buildGrowthCalendarWeek>}
          timezone={profile?.timezone ?? "UTC"}
          pillarLabels={pillarLabels}
          loading={loading}
          error={error}
          onOpenItem={setSelectedItem}
          onUpdateItem={updateItem}
        />
      ) : null}

      {selectedItem ? (
        <ContentItemDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdate={updateItem}
        />
      ) : null}
    </section>
  );
}
