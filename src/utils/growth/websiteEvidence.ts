import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { extractMediaUrls, type WebPageSignal } from "../socialProposals";

function readableText(node: Node): string {
  const clone = node.cloneNode(true) as Element;
  for (const block of clone.querySelectorAll("p, div, li, pre, h1, h2, h3, h4, blockquote, tr, br")) {
    block.prepend("\n");
    block.append("\n");
  }
  return (clone.textContent ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Server-side article extraction; never execute scripts, fetch subresources or return HTML. */
export function extractWebsiteEvidence(text: string, pageUrl: string, isHtml = true, limit = 12000): WebPageSignal {
  if (!isHtml) return { title: null, excerpt: text.trim().slice(0, limit), mediaUrls: [] };
  const { document } = parseHTML(text.slice(0, 600000));
  const mediaUrls = extractMediaUrls(text, pageUrl);
  const title = document.querySelector("title")?.textContent?.trim() || null;
  for (const element of document.querySelectorAll("script, style, noscript, svg, nav, footer, header, aside, form, [hidden], [aria-hidden='true']")) {
    element.remove();
  }
  // Keep a fallback for short product pages that do not resemble an article.
  const fallback = document.querySelector("main, article") ?? document.body;
  const fallbackText = fallback ? readableText(fallback) : "";
  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(document, {
      maxElemsToParse: 20000, charThreshold: 150, disableJSONLD: true, serializer: readableText,
    }).parse();
  } catch { /* Unusual or oversized DOMs still retain bounded, cleaned text. */ }
  return {
    title: article?.title?.trim() || title,
    excerpt: (article?.content || fallbackText).trim().slice(0, limit),
    mediaUrls,
  };
}
