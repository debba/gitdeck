import { useEffect, useMemo, useRef, useState } from "react";
import { fetchProject, fetchProjects, moveProjectItem } from "../../api/github";
import { CompressIcon, ExpandIcon } from "../common/Icons";
import type { ProjectDetails, ProjectItem, ProjectSummary } from "../../types/github";
import { formatRelativeTime } from "../../utils/format";
import { useI18n } from "../../i18n/I18nProvider";

const OPTION_COLORS: Record<string, string> = {
  GRAY: "#8b949e",
  BLUE: "#3b82f6",
  GREEN: "#22c55e",
  YELLOW: "#eab308",
  ORANGE: "#f97316",
  RED: "#ef4444",
  PINK: "#ec4899",
  PURPLE: "#8b5cf6",
};

function statusValueOf(item: ProjectItem, fieldId: string) {
  return (item.fieldValues?.nodes || []).find((value) => value.__typename === "ProjectV2ItemFieldSingleSelectValue" && value.field?.id === fieldId);
}

interface KanbanViewProps {
  onCountChange?: (count: number) => void;
}

export function KanbanView({ onCountChange }: KanbanViewProps) {
  const { t } = useI18n();
  const boardRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [boardFullscreen, setBoardFullscreen] = useState(false);

  async function loadProjects() {
    setLoading(true);
    setError("");
    try {
      const result = await fetchProjects();
      setProjects(result.projects);
      onCountChange?.(result.projects.length);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function openProject(id: string) {
    setLoading(true);
    setError("");
    try {
      const result = await fetchProject(id);
      setProject(result.project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("board-focus", boardFullscreen);
  }, [boardFullscreen]);

  useEffect(() => {
    function syncFullscreenState() {
      const active = document.fullscreenElement === boardRef.current;
      setBoardFullscreen(active);
    }

    function exitFallback(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.fullscreenElement) {
        setBoardFullscreen(false);
      }
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("keydown", exitFallback);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("keydown", exitFallback);
      document.body.classList.remove("board-focus");
    };
  }, []);

  const statusField = useMemo(() => {
    const fields = project?.fields || [];
    const singles = fields.filter((field) => field.__typename === "ProjectV2SingleSelectField");
    return singles.find((field) => /^status$/i.test(field.name)) || singles[0];
  }, [project]);

  async function moveItem(item: ProjectItem, optionId: string) {
    if (!project || !statusField) return;
    const current = statusValueOf(item, statusField.id)?.optionId || "";
    if (current === optionId) return;
    setPending((items) => new Set(items).add(item.id));
    try {
      await moveProjectItem({ projectId: project.id, itemId: item.id, fieldId: statusField.id, optionId: optionId || null });
      const next = await fetchProject(project.id);
      setProject(next.project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending((items) => {
        const next = new Set(items);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function toggleBoardFullscreen() {
    if (boardFullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen();
      setBoardFullscreen(false);
      return;
    }

    setBoardFullscreen(true);
    try {
      await boardRef.current?.requestFullscreen();
    } catch {
      setBoardFullscreen(true);
    }
  }

  const fullscreenButton = (
    <button
      className="btn board-fullscreen-btn"
      type="button"
      onClick={toggleBoardFullscreen}
      aria-pressed={boardFullscreen}
      title={boardFullscreen ? t("board.exitFullscreen") : t("board.fullscreen")}
    >
      {boardFullscreen ? <CompressIcon /> : <ExpandIcon />}
      {boardFullscreen ? t("board.exitFullscreen") : t("board.fullscreen")}
    </button>
  );

  if (!project) {
    return (
      <div className="view-kanban" ref={boardRef} style={{ display: "block" }}>
        <div className="kanban-toolbar">
          <span className="count-chip"><strong>{projects.length}</strong> {t("board.boards")}</span>
          <div className="spacer" style={{ flex: 1 }} />
          {fullscreenButton}
          <button className="btn" onClick={loadProjects}>{t("common.reload")}</button>
        </div>
        {error ? <div className="kanban-info-banner">{error}</div> : null}
        {loading ? <div className="empty"><div className="big">{t("board.loading")}</div></div> : (
          <div className="repos-grid">
            {projects.map((item) => (
              <article className="repo-card" key={item.id} tabIndex={0} onClick={() => openProject(item.id)} onKeyDown={(event) => event.key === "Enter" && openProject(item.id)}>
                <div className="rc-head">
                  <div className="rc-title"><a>{item.owner?.login || t("board.project")}<span className="slash">/</span>{item.title}</a></div>
                  <div className="repo-badges"><span className="rb fork">{item.items?.totalCount ?? 0} items</span></div>
                </div>
                <div className="repo-desc">{item.shortDescription || t("repo.noDescription")}</div>
                <div className="rc-stats"><span>updated {item.updatedAt ? formatRelativeTime(item.updatedAt) : "—"}</span></div>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!statusField?.options?.length) {
    return (
      <div className="view-kanban" ref={boardRef} style={{ display: "block" }}>
        <div className="kanban-toolbar">
          <button className="btn" onClick={() => setProject(null)}>{t("board.allBoards")}</button>
          <div className="spacer" style={{ flex: 1 }} />
          {fullscreenButton}
        </div>
        <div className="kanban-info-banner">{t("board.noStatusField")}</div>
      </div>
    );
  }

  const columns = [...statusField.options, { id: "", name: t("board.noStatus"), color: "GRAY" }].map((option) => ({
    option,
    items: project.items.filter((item) => (statusValueOf(item, statusField.id)?.optionId || "") === option.id),
  }));

  return (
    <div className="view-kanban" ref={boardRef} style={{ display: "block" }}>
      <div className="kanban-toolbar">
        <button className="btn" onClick={() => setProject(null)}>{t("board.allBoards")}</button>
        <span className="kanban-meta"><a href={project.url} target="_blank" rel="noreferrer">{project.owner?.login} / {project.title}</a></span>
        <span className="count-chip"><strong>{project.items.length}</strong> {t("common.items")}</span>
        <div className="spacer" style={{ flex: 1 }} />
        {fullscreenButton}
      </div>
      {error ? <div className="kanban-info-banner">{error}</div> : null}
      <div className="kanban-board">
        {columns.map(({ option, items }) => (
          <section
            className="kcol"
            key={option.id || "none"}
            data-option={option.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const item = project.items.find((candidate) => candidate.id === event.dataTransfer.getData("text/plain"));
              if (item) void moveItem(item, option.id);
            }}
          >
            <div className="kcol-head">
              <span className="dot" style={{ background: OPTION_COLORS[option.color || "GRAY"] || "#8b949e" }} />
              <h4>{option.name}</h4>
              <span className="count">{items.length}</span>
            </div>
            <div className="kcol-body">
              {items.length ? items.map((item) => {
                const content = item.content || {};
                return (
                  <article className={`kcard ${pending.has(item.id) ? "pending" : ""}`} key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}>
                    <div className="kcard-repo"><span className={`kcard-type ${content.__typename || item.type}`}>{content.__typename === "PullRequest" ? "PR" : content.__typename || item.type}</span><span className="owner-name">{content.repository?.nameWithOwner || t("list.draft")}</span></div>
                    <div className="kcard-title">{content.url ? <a href={content.url} target="_blank" rel="noreferrer">{content.title}</a> : content.title}</div>
                    <div className="kcard-meta">{content.number ? `#${content.number}` : ""}<span>{content.updatedAt ? formatRelativeTime(content.updatedAt) : ""}</span></div>
                  </article>
                );
              }) : <div className="kcol-empty">{t("board.noItems")}</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
