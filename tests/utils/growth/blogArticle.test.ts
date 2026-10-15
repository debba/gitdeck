import { describe, expect, it } from "vitest";
import { blogInterventionProposalIssue, exportGrowthBlogMarkdown, growthBlogFilename } from "../../../src/utils/growth/blogArticle";

describe("blog intervention proposal validation", () => {
  it("requires an article structure and allows only known evidence URLs", () => {
    const article = { title: "Protocol design", summary: "For maintainers", content: "# Protocol design\n\nIntroduction\n\n## Mechanism\n\nExplanation", sources: ["https://example.com/design"] };
    expect(blogInterventionProposalIssue(article, article.sources)).toBeNull();
    expect(blogInterventionProposalIssue(article, [])).toContain("supplied evidence URLs");
    expect(blogInterventionProposalIssue({ ...article, content: "An outline for later" }, article.sources)).toContain("Markdown title and sections");
    expect(blogInterventionProposalIssue({ ...article, summary: "" }, article.sources)).toContain("audience");
    expect(blogInterventionProposalIssue(null, [])).toBeTruthy();
  });
});

describe("blog Markdown export", () => {
  const item = {
    title: 'Why "small" matters: a tradeoff',
    body: "# Why small matters\n\nA **concrete** problem.\n\n## Implementation\n\n```ts\nconst count = 2;\n```",
    pillar: "engineering",
    scheduledFor: "2026-09-21T10:00:00Z",
    generatedAt: "2026-09-18T10:00:00Z",
    createdAt: "2026-09-17T10:00:00Z",
  };

  it("exports safely quoted frontmatter while preserving Markdown and code", () => {
    const result = exportGrowthBlogMarkdown(item);
    expect(result).toContain(`title: ${JSON.stringify(item.title)}`);
    expect(result).toContain('date: "2026-09-21T10:00:00Z"');
    expect(result).toContain('tags: ["engineering"]');
    expect(result).toContain('excerpt: "A concrete problem."');
    expect(result).toContain(item.body);
    expect(result.match(/^# /gm)).toHaveLength(1);
    expect(exportGrowthBlogMarkdown({ ...item, body: "New text", scheduledFor: null }))
      .toContain(`# ${item.title}\n\nNew text`);
  });

  it("preserves user frontmatter without duplicating it", () => {
    const body = '---\ntitle: "Custom"\nauthors: ["maintainer"]\n---\n\n# Article';
    expect(exportGrowthBlogMarkdown({ ...item, body })).toBe(`${body}\n`);
  });

  it("creates portable filenames including non-Latin titles", () => {
    expect(growthBlogFilename("../Café: a / faster grid?" )).toBe("cafe-a-faster-grid.md");
    expect(growthBlogFilename("数据库设计")).toBe("数据库设计.md");
    expect(growthBlogFilename("../")).toBe("blog-article.md");
  });
});
