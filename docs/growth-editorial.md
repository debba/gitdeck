# Growth editorial generation

## What changes

AI intervention recommendations, social campaign proposals and individual content drafts now share an editorial gate. Planning slots and weekly analytics reviews retain their existing workflows.

1. Gather repository evidence and the account's project source library. Website text is extracted with Mozilla Readability rather than flattening navigation and article text together. Short product pages use a cleaned-text fallback; plain-text sources remain plain text.
2. Generate content using the audience, language, voice and exclusions from the Growth profile. Interventions include recent recommendations; individual drafts include up to eight earlier content excerpts from the same account and repository to discourage repetition. This history is not treated as factual evidence.
3. Validate the output's format requirements. Intervention generation accepts one to five recommendations so sparse evidence does not force filler.
4. Ask the configured model, in a separate editorial request, to assess grounding, specificity, reader value and structure. It separates suggested improvements (`issues`) from concrete factual or explicit requirement failures (`blockingIssues`). Recommendations have their own rubric: proposed work does not need a finished article's narrative, runnable examples or already measured results. Multi-asset campaigns are judged by their weakest asset.
5. Strong drafts (all scores at least 4/5 and no feedback) return immediately. Otherwise rewrite once with the original evidence, previous draft and feedback, then validate and review again. After revision, valid work with grounding at least 4/5 and no blocking issues can be returned despite remaining style suggestions or subjective scores. If the revision regresses, retain the earlier validated, grounded candidate. Do not discard usable work for failing to achieve editorial perfection.

Invalid reviews and provider errors still surface as errors. When neither candidate is usable, the error includes the actual format failure or a bounded summary of unresolved review issues, rather than indiscriminately asking for richer sources. No generic fallback is substituted for rejected AI output.

A successful first draft takes two AI requests; a reviewed revision takes four at most. Larger source excerpts and additional calls increase token cost and latency. No additional API key or hosted research service is needed: all AI calls use the existing configured provider, server-side.

Existing saved drafts are not automatically rewritten. Use **Regenerate** or refresh a draft to apply the new pipeline. Protected content remains protected. Without a configured AI provider, the existing deterministic fallbacks remain available; they do not pass through the AI editorial gate.

## Blog discovery and drafting

New profiles enable Blog with a default cadence of one article per week (account cadence settings still take precedence). Existing saved profiles are not changed: enable **Blog** in the repository profile and set a positive blog cadence to include articles in weekly plans.

AI recommendations carry an explicit `destination` (`blog`, `social`, `communities`, or `other`), stored with the intervention. Grouping no longer depends on the model including an English or Italian keyword in the title; legacy interventions still use the existing text/content inference. When Blog is enabled and substantive source text is available, recommendation generation reserves at least one blog idea. Documentation and README material can support evergreen articles without a recent release. Multiple source-backed angles can produce both a workflow article and a technical deep dive.

**Draft from intervention** now creates one complete Markdown article for a Blog intervention, rather than always generating three social posts. It uses the same editorial review workflow, longer source excerpts and the blog token budget. Articles are saved as `channel=blog`, `format=doc`, with source URLs and optional media. Cached articles are reused; refresh updates editable drafts or creates a replacement without altering protected content. Generation failures do not create empty placeholder drafts. Existing social campaigns are not deleted or silently converted.

## Open-source components and research

- [Mozilla Readability](https://github.com/mozilla/readability) (Apache-2.0): the production dependency that extracts article text from HTML.
- [LinkeDOM](https://github.com/WebReflection/linkedom) (ISC): a lightweight DOM implementation for server-side extraction. No browser, script evaluation or subresource loading is requested. Only text and existing media URLs are returned, never extracted HTML for rendering. Existing bounded fetching, public-address checks and redirect validation remain in place.
- [Self-Refine](https://github.com/madaan/self-refine): inspiration for the draft → feedback → revision pattern. GitDeck implements a bounded TypeScript adaptation using its existing multi-provider client; it does not install the project's Python stack or claim its published evaluation results.

## Limits and evaluation

The editor uses the same configured model as the writer. Its scores are heuristic quality checks, **not independent fact verification or a guarantee of interesting writing**. Sparse sources, misleading source material and model limitations can still affect results. Review copy before publishing, especially commands, performance claims and statements about shipped features.

To improve inputs, add actual documentation, implementation explanations and release notes to the project source library; set a specific audience and avoid list in the Growth profile. More words or a larger model alone do not establish quality.

Automated coverage lives in:

- `tests/utils/growth/websiteEvidence.test.ts`: article extraction, boilerplate removal, short-page fallback and plain text.
- `tests/utils/growth/editorialQuality.test.ts`: strict review parsing, thresholds and recommendation validation.
- `tests/server/growthEditorial.test.ts`: feedback propagation, bounded retries, provider errors and rejection.
- `tests/server/goalEditorial.test.ts`: intervention and campaign integration with richer evidence and profiles.
- `tests/server/growthDrafter.test.ts`: draft integration, unchanged storage on failure, account isolation and existing media/format behavior.

These tests use synthetic evidence and mocked model answers. They verify the pipeline, not actual model writing quality. For a real evaluation, compare old and regenerated outputs on the same repository sources and provider, including rich release notes, unfinished PRs and sparse documentation. Have a reader blind-rate factual support, useful detail, originality and willingness to read/share, and record rejection rate, latency and token cost. Do not interpret the model's own scores as a measured improvement over the previous implementation.
