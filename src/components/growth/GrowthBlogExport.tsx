import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { GrowthContentItem } from "../../types/growth";
import { exportGrowthBlogMarkdown, growthBlogFilename } from "../../utils/growth/blogArticle";

export function GrowthBlogExport({ item }: { item: GrowthContentItem }) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const markdown = exportGrowthBlogMarkdown(item);

  useEffect(() => {
    if (!item.body.trim()) return;
    const objectUrl = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [markdown, item.body]);

  return item.body.trim() && url ? (
    <a className="btn ghost" href={url} download={growthBlogFilename(item.title)}>{t("growth.blogDownload")}</a>
  ) : null;
}
