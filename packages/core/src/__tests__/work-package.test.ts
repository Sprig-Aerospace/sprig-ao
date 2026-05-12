import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkPackage,
  listWorkPackages,
  readWorkPackage,
  updateWorkPackage,
} from "../work-package.js";
import { getWorkPackagePath } from "../paths.js";

describe("work-package", () => {
  let tempRoot: string;
  let oldHome: string | undefined;
  let oldUserProfile: string | undefined;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `ao-work-package-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
    oldHome = process.env["HOME"];
    oldUserProfile = process.env["USERPROFILE"];
    process.env["HOME"] = tempRoot;
    process.env["USERPROFILE"] = tempRoot;
  });

  afterEach(() => {
    if (oldHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = oldHome;
    if (oldUserProfile === undefined) delete process.env["USERPROFILE"];
    else process.env["USERPROFILE"] = oldUserProfile;
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("creates and reads a work package with multi-repo and multi-session references", () => {
    const created = createWorkPackage({
      id: "release-train-42",
      title: "Release train 42",
      status: "in_progress",
      blockers: ["waiting on shared schema"],
      repositories: [
        { projectId: "api", repo: "acme/api", repoPath: "/repos/api", defaultBranch: "main" },
        { projectId: "web", repo: "acme/web", repoPath: "/repos/web", defaultBranch: "main" },
      ],
      sessions: [
        { projectId: "api", sessionId: "api-12", branch: "feat/wp-42-api", prNumber: 10 },
        { projectId: "web", sessionId: "web-7", branch: "feat/wp-42-web", prNumber: 11 },
      ],
      prs: [
        {
          owner: "acme",
          repo: "api",
          number: 10,
          url: "https://github.com/acme/api/pull/10",
          projectId: "api",
          sessionId: "api-12",
        },
        {
          owner: "acme",
          repo: "web",
          number: 11,
          url: "https://github.com/acme/web/pull/11",
          projectId: "web",
          sessionId: "web-7",
        },
      ],
    });

    expect(created).toMatchObject({
      id: "release-train-42",
      title: "Release train 42",
      status: "in_progress",
      blockers: ["waiting on shared schema"],
    });
    expect(created.repositories).toHaveLength(2);
    expect(created.sessions).toHaveLength(2);
    expect(created.prs).toHaveLength(2);

    const stored = readWorkPackage("release-train-42");
    expect(stored).toEqual(created);
  });

  it("updates status, blockers, and linked refs while preserving createdAt", () => {
    const created = createWorkPackage({
      id: "migration-1",
      title: "Migration rollout",
      description: "Coordinate backend and frontend changes",
      repositories: [{ projectId: "api", repo: "acme/api" }],
      sessions: [{ projectId: "api", sessionId: "api-1", branch: "feat/migration-1" }],
    });

    const updated = updateWorkPackage("migration-1", {
      status: "blocked",
      blockers: ["Awaiting prod access", "Awaiting prod access", "Need DBA review"],
      repositories: [
        { projectId: "api", repo: "acme/api" },
        { projectId: "web", repo: "acme/web" },
      ],
      sessions: [
        { projectId: "api", sessionId: "api-1", branch: "feat/migration-1" },
        { projectId: "web", sessionId: "web-2", branch: "feat/migration-1-web" },
      ],
      prs: [
        {
          owner: "acme",
          repo: "web",
          number: 22,
          url: "https://github.com/acme/web/pull/22",
          projectId: "web",
          sessionId: "web-2",
        },
      ],
    });

    expect(updated.status).toBe("blocked");
    expect(updated.blockers).toEqual(["Awaiting prod access", "Need DBA review"]);
    expect(updated.repositories.map((repo) => repo.projectId)).toEqual(["api", "web"]);
    expect(updated.sessions.map((session) => session.sessionId)).toEqual(["api-1", "web-2"]);
    expect(updated.prs).toHaveLength(1);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
  });

  it("lists work packages ordered by most recent update", () => {
    createWorkPackage({ id: "wp-a", title: "Package A" });
    createWorkPackage({ id: "wp-b", title: "Package B" });
    updateWorkPackage("wp-a", { status: "done" });

    expect(listWorkPackages().map((entry) => entry.id)).toEqual(["wp-a", "wp-b"]);
  });

  it("writes JSON files under the AO work-packages directory", () => {
    createWorkPackage({
      id: "wp-storage",
      title: "Storage check",
      blockers: ["pending signoff"],
    });

    const content = readFileSync(getWorkPackagePath("wp-storage"), "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed["id"]).toBe("wp-storage");
    expect(parsed["blockers"]).toEqual(["pending signoff"]);
    expect(parsed["repositories"]).toEqual([]);
    expect(parsed["sessions"]).toEqual([]);
  });

  it("rejects unsafe ids", () => {
    expect(() =>
      createWorkPackage({
        id: "../oops",
        title: "Unsafe",
      }),
    ).toThrow(/Unsafe work package ID/);
  });
});
