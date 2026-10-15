import type { InterventionDestination } from "../../types/goals";
import type { GrowthChannelSelection } from "../../types/growth";

/** Keep article discovery independent of social cadence; a README can support evergreen articles. */
export function interventionEditorialPolicy(channels: GrowthChannelSelection, evidence: readonly (string | null | undefined)[]) {
  const destinations: InterventionDestination[] = ["other"];
  if (channels.blog) destinations.push("blog");
  if (channels.x || channels.linkedin || channels.mastodon || channels.bluesky) destinations.push("social");
  if (channels.discussion) destinations.push("communities");
  const requireBlog = Boolean(channels.blog && evidence.some((text) => text && text.trim().length >= 160));
  return {
    destinations,
    requireBlog,
    guidance: channels.blog
      ? "Prioritize blog articles as primary deliverables, not merely social launch copy. When supporting text is available, include at least one destination=blog recommendation. With several distinct supported angles, propose two: a practical workflow and an implementation/tradeoff article. A README, documentation or website can support an evergreen tutorial even without a new release. State the article thesis, intended reader and outline in action, and name the evidence. Distribution to social networks or communities is secondary and does not change a blog article's destination. Never invent evidence to fill a quota."
      : "The blog channel is disabled in the saved profile; do not propose blog articles.",
  };
}
