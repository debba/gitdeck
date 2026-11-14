import { describe, expect, it } from "vitest";
import {
  gitLabPipelineUrl,
  mapGitLabHeadPipeline,
  mapGitLabPipelineStatus,
  pickGitLabHeadPipeline,
} from "../../src/utils/gitlabPipeline";

describe("mapGitLabPipelineStatus", () => {
  it.each([
    ["success", "success"],
    ["failed", "failed"],
    ["running", "running"],
    ["pending", "pending"],
    ["canceled", "canceled"],
    ["skipped", "skipped"],
    ["manual", "manual"],
    ["created", "pending"],
    ["waiting_for_resource", "pending"],
    ["preparing", "pending"],
    ["scheduled", "pending"],
    ["canceling", "canceled"],
    [" FAILED ", "failed"],
  ] as const)("maps %s to %s", (raw, expected) => {
    expect(mapGitLabPipelineStatus(raw)).toBe(expected);
  });

  it("ignores missing and unknown statuses", () => {
    expect(mapGitLabPipelineStatus(null)).toBeNull();
    expect(mapGitLabPipelineStatus(undefined)).toBeNull();
    expect(mapGitLabPipelineStatus("")).toBeNull();
    expect(mapGitLabPipelineStatus("not-a-status")).toBeNull();
  });
});

describe("gitLabPipelineUrl", () => {
  it("keeps the absolute web url GitLab returns for a self-hosted instance", () => {
    expect(gitLabPipelineUrl("https://gitlab.example.com", "group/app", {
      id: 9,
      web_url: "https://gitlab.example.com/group/app/-/pipelines/9",
    })).toBe("https://gitlab.example.com/group/app/-/pipelines/9");
  });

  it("joins a relative pipeline path onto a custom base url", () => {
    expect(gitLabPipelineUrl("https://git.example.com/gitlab", "team/app", {
      web_url: "/team/app/-/pipelines/3",
    })).toBe("https://git.example.com/gitlab/team/app/-/pipelines/3");
  });

  it("builds a pipeline url from the instance and project path", () => {
    expect(gitLabPipelineUrl("https://gitlab.example.com/", "group/sub/app", { id: 15 })).toBe(
      "https://gitlab.example.com/group/sub/app/-/pipelines/15",
    );
  });

  it("returns null when there is no url and no pipeline id", () => {
    expect(gitLabPipelineUrl("https://gitlab.example.com", "group/app", {})).toBeNull();
  });
});

describe("mapGitLabHeadPipeline", () => {
  it("returns null when the merge request has no pipeline", () => {
    expect(mapGitLabHeadPipeline(null, "https://gitlab.com", "group/app")).toBeNull();
    expect(mapGitLabHeadPipeline({ id: 1, status: null }, "https://gitlab.com", "group/app")).toBeNull();
  });

  it("maps a head pipeline that has a status but no link", () => {
    expect(mapGitLabHeadPipeline({ status: "manual" }, "https://gitlab.com", "")).toEqual({
      status: "manual",
      url: null,
    });
  });
});

describe("pickGitLabHeadPipeline", () => {
  const pipelines = [
    { id: 3, sha: "newer", ref: "feature", status: "running" },
    { id: 2, sha: "head", ref: "feature", status: "failed" },
    { id: 1, sha: "other", ref: "main", status: "success" },
  ];

  it("prefers the newest pipeline for the merge request head sha", () => {
    expect(pickGitLabHeadPipeline(pipelines, "head", "feature")?.id).toBe(2);
  });

  it("falls back to the newest pipeline on the source branch", () => {
    expect(pickGitLabHeadPipeline(pipelines, "missing", "feature")?.id).toBe(3);
  });

  it("skips pipelines whose status cannot be shown", () => {
    expect(pickGitLabHeadPipeline(
      [{ id: 4, sha: "head", ref: "feature", status: "bogus" }],
      "head",
      "feature",
    )).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(pickGitLabHeadPipeline(pipelines, "absent", "absent")).toBeNull();
    expect(pickGitLabHeadPipeline([], "head", "feature")).toBeNull();
  });
});
