export interface DependentItem {
  owner: string;
  repo: string;
  nameWithOwner: string;
  url: string;
  stars: number;
  forks: number;
  avatar: string;
}

export interface DependentsPage {
  items: DependentItem[];
  totalRepos: number;
  totalPackages: number;
  hasNextPage: boolean;
  nextCursor: string | null;
  hasPrevPage: boolean;
  prevCursor: string | null;
  notAvailable: boolean;
}

export const EMPTY_DEPENDENTS_PAGE: DependentsPage = {
  items: [],
  totalRepos: 0,
  totalPackages: 0,
  hasNextPage: false,
  nextCursor: null,
  hasPrevPage: false,
  prevCursor: null,
  notAvailable: true,
};

function parseCount(raw: string | undefined): number {
  return raw ? Number(raw.replace(/,/g, "")) : 0;
}

/** Extracts the dependents list from the HTML of `github.com/<owner>/<repo>/network/dependents`. */
export function parseDependentsHtml(html: string): DependentsPage {
  const notAvailable =
    /We haven(?:'|&#39;)t found any dependents for this repository yet/i.test(html) ||
    /This repository is not used by any other repository/i.test(html);

  const repoCountMatch = /([\d,]+)\s+Repositor(?:y|ies)/.exec(html);
  const pkgCountMatch = /([\d,]+)\s+Packages?/.exec(html);

  const items: DependentItem[] = [];
  const seen = new Set<string>();
  const rowMarker = '<div class="Box-row d-flex flex-items-center"';
  const pagMarker = 'class="paginate-container"';
  const parts = html.split(rowMarker);
  for (let i = 1; i < parts.length; i++) {
    let chunk = parts[i];
    const pagIdx = chunk.indexOf(pagMarker);
    if (pagIdx >= 0) chunk = chunk.substring(0, pagIdx);

    const repoLinkMatch = /data-hovercard-type="repository"[^>]*href="\/([^"\/]+)\/([^"?#]+)"/.exec(chunk);
    if (!repoLinkMatch) continue;
    const owner = repoLinkMatch[1];
    const repoName = repoLinkMatch[2];
    const nwo = `${owner}/${repoName}`;
    if (seen.has(nwo)) continue;
    seen.add(nwo);

    const starsMatch = /octicon-star[\s\S]{0,2000}?<\/svg>\s*([\d,]+)/.exec(chunk);
    const forksMatch = /octicon-repo-forked[\s\S]{0,2000}?<\/svg>\s*([\d,]+)/.exec(chunk);
    const avatarMatch =
      /<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="([^"]+)"/.exec(chunk) ||
      /<img[^>]*src="([^"]+)"[^>]*class="[^"]*avatar/.exec(chunk);

    items.push({
      owner,
      repo: repoName,
      nameWithOwner: nwo,
      url: `https://github.com/${nwo}`,
      stars: parseCount(starsMatch?.[1]),
      forks: parseCount(forksMatch?.[1]),
      avatar: avatarMatch ? avatarMatch[1].replace(/&amp;/g, "&") : "",
    });
  }

  // Pagination: hrefs encode `&` as `&amp;`, so just match the cursor token.
  const nextMatch = /href="[^"]*dependents_after=([^"&]+)[^"]*"[^>]*>\s*Next\s*<\/a>/.exec(html);
  const prevMatch = /href="[^"]*dependents_before=([^"&]+)[^"]*"[^>]*>\s*Previous\s*<\/a>/.exec(html);

  return {
    items,
    totalRepos: parseCount(repoCountMatch?.[1]),
    totalPackages: parseCount(pkgCountMatch?.[1]),
    hasNextPage: !!nextMatch,
    nextCursor: nextMatch ? nextMatch[1] : null,
    hasPrevPage: !!prevMatch,
    prevCursor: prevMatch ? prevMatch[1] : null,
    notAvailable,
  };
}
