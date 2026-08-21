import type { GhRepo } from "../../types/github";
import type { InboxItem } from "../../utils/inbox";
import { TriageWorkspace } from "./TriageWorkspace";
import { useI18n } from "../../i18n/I18nProvider";

interface InboxViewProps {
  items: InboxItem[];
  mailboxLabel: string;
  search: string;
  page: number;
  pageSize: number;
  reposByName: Map<string, GhRepo>;
  onRepoClick: (repo: GhRepo) => void;
  onMarkRead: (threadId: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function InboxView({
  items,
  mailboxLabel,
  search,
  page,
  pageSize,
  reposByName,
  onRepoClick,
  onMarkRead,
  onRefresh,
  onPageChange,
  onPageSizeChange,
}: InboxViewProps) {
  const { t } = useI18n();
  return (
    <TriageWorkspace
      className="view-inbox"
      items={items}
      title={mailboxLabel}
      emptyTitle={t("inbox.emptyTitle")}
      emptyMessage={t("inbox.emptyMessage")}
      reposByName={reposByName}
      onRepoClick={onRepoClick}
      searchPlaceholder={t("inbox.search")}
      search={search}
      hideInternalSearch
      page={page}
      pageSize={pageSize}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onMarkRead={onMarkRead}
      onRefresh={onRefresh}
    />
  );
}
