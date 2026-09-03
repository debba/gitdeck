import { describe, expect, it } from "vitest";
import { parseDependentsHtml } from "../../src/utils/dependents";

const ROW = (owner: string, repo: string, stars: string, forks: string) => `
<div class="Box-row d-flex flex-items-center">
  <img class="avatar mr-2" src="https://avatars.githubusercontent.com/u/1?s=40&amp;v=4" />
  <a data-hovercard-type="repository" href="/${owner}/${repo}">${repo}</a>
  <svg class="octicon octicon-star"></svg> ${stars}
  <svg class="octicon octicon-repo-forked"></svg> ${forks}
</div>`;

const PAGE = `
<div class="table-list-header-toggle">
  <a>1,204 Repositories</a>
  <a>37 Packages</a>
</div>
${ROW("acme", "widgets", "1,234", "56")}
${ROW("acme", "widgets", "1,234", "56")}
${ROW("other", "tool", "7", "0")}
<div class="paginate-container">
  <a href="/acme/lib/network/dependents?dependents_before=abc&amp;dependent_type=REPOSITORY">Previous</a>
  <a href="/acme/lib/network/dependents?dependents_after=xyz&amp;dependent_type=REPOSITORY">Next</a>
</div>`;

describe("parseDependentsHtml", () => {
  it("extracts totals, unique rows and pagination cursors", () => {
    const page = parseDependentsHtml(PAGE);

    expect(page.totalRepos).toBe(1204);
    expect(page.totalPackages).toBe(37);
    expect(page.notAvailable).toBe(false);
    expect(page.items).toEqual([
      {
        owner: "acme",
        repo: "widgets",
        nameWithOwner: "acme/widgets",
        url: "https://github.com/acme/widgets",
        stars: 1234,
        forks: 56,
        avatar: "https://avatars.githubusercontent.com/u/1?s=40&v=4",
      },
      expect.objectContaining({ nameWithOwner: "other/tool", stars: 7, forks: 0 }),
    ]);
    expect(page).toMatchObject({ hasNextPage: true, nextCursor: "xyz", hasPrevPage: true, prevCursor: "abc" });
  });

  it("flags repositories without dependents", () => {
    const page = parseDependentsHtml("<p>We haven&#39;t found any dependents for this repository yet.</p>");

    expect(page.notAvailable).toBe(true);
    expect(page.items).toEqual([]);
    expect(page).toMatchObject({ totalRepos: 0, hasNextPage: false, nextCursor: null });
  });
});
