import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { atomicWriteFileSync } from "./atomic-write.js";
import { withFileLockSync } from "./file-lock.js";
import { getWorkPackagePath, getWorkPackagesDir } from "./paths.js";
import type {
  CreateWorkPackageInput,
  UpdateWorkPackageInput,
  WorkPackage,
  WorkPackageId,
  WorkPackagePRRef,
  WorkPackageRepositoryRef,
  WorkPackageSessionRef,
  WorkPackageStatus,
} from "./types.js";

const WORK_PACKAGE_VERSION = 1;
const WORK_PACKAGE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const JSON_EXTENSION = ".json";
const VALID_STATUSES = new Set<WorkPackageStatus>([
  "planned",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);

function assertValidWorkPackageId(workPackageId: string): void {
  if (
    !workPackageId ||
    workPackageId === "." ||
    workPackageId === ".." ||
    !WORK_PACKAGE_ID_PATTERN.test(workPackageId)
  ) {
    throw new Error(`Unsafe work package ID: "${workPackageId}"`);
  }
}

function parseWorkPackage(raw: unknown): WorkPackage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    value["version"] !== WORK_PACKAGE_VERSION ||
    typeof value["id"] !== "string" ||
    typeof value["title"] !== "string" ||
    typeof value["status"] !== "string" ||
    !Array.isArray(value["blockers"]) ||
    !Array.isArray(value["repositories"]) ||
    !Array.isArray(value["sessions"]) ||
    !Array.isArray(value["prs"]) ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string"
  ) {
    return null;
  }
  if (!VALID_STATUSES.has(value["status"] as WorkPackageStatus)) return null;

  const repositories = normalizeRepositories(value["repositories"]);
  const sessions = normalizeSessions(value["sessions"]);
  const prs = normalizePRs(value["prs"]);
  const blockers = normalizeBlockers(value["blockers"]);

  return {
    version: WORK_PACKAGE_VERSION,
    id: value["id"],
    title: value["title"].trim(),
    ...(typeof value["description"] === "string" && value["description"].trim().length > 0
      ? { description: value["description"].trim() }
      : {}),
    status: value["status"] as WorkPackageStatus,
    blockers,
    repositories,
    sessions,
    prs,
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function normalizeBlockers(blockers: unknown): string[] {
  if (!Array.isArray(blockers)) return [];
  return [...new Set(
    blockers
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )];
}

function normalizeRepositories(repositories: unknown): WorkPackageRepositoryRef[] {
  if (!Array.isArray(repositories)) return [];
  const deduped = new Map<string, WorkPackageRepositoryRef>();
  for (const entry of repositories) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    if (typeof value["projectId"] !== "string" || value["projectId"].trim().length === 0) continue;
    const normalized: WorkPackageRepositoryRef = {
      projectId: value["projectId"].trim(),
      ...(typeof value["repoPath"] === "string" && value["repoPath"].trim().length > 0
        ? { repoPath: value["repoPath"].trim() }
        : {}),
      ...(typeof value["repo"] === "string" && value["repo"].trim().length > 0
        ? { repo: value["repo"].trim() }
        : {}),
      ...(typeof value["defaultBranch"] === "string" && value["defaultBranch"].trim().length > 0
        ? { defaultBranch: value["defaultBranch"].trim() }
        : {}),
    };
    deduped.set(JSON.stringify(normalized), normalized);
  }
  return [...deduped.values()];
}

function normalizeSessions(sessions: unknown): WorkPackageSessionRef[] {
  if (!Array.isArray(sessions)) return [];
  const deduped = new Map<string, WorkPackageSessionRef>();
  for (const entry of sessions) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    if (
      typeof value["sessionId"] !== "string" ||
      value["sessionId"].trim().length === 0 ||
      typeof value["projectId"] !== "string" ||
      value["projectId"].trim().length === 0
    ) {
      continue;
    }
    const normalized: WorkPackageSessionRef = {
      sessionId: value["sessionId"].trim(),
      projectId: value["projectId"].trim(),
      ...(typeof value["repo"] === "string" && value["repo"].trim().length > 0
        ? { repo: value["repo"].trim() }
        : {}),
      ...(typeof value["branch"] === "string" && value["branch"].trim().length > 0
        ? { branch: value["branch"].trim() }
        : {}),
      ...(typeof value["prNumber"] === "number" ? { prNumber: value["prNumber"] } : {}),
      ...(typeof value["prUrl"] === "string" && value["prUrl"].trim().length > 0
        ? { prUrl: value["prUrl"].trim() }
        : {}),
    };
    deduped.set(`${normalized.projectId}:${normalized.sessionId}`, normalized);
  }
  return [...deduped.values()];
}

function normalizePRs(prs: unknown): WorkPackagePRRef[] {
  if (!Array.isArray(prs)) return [];
  const deduped = new Map<string, WorkPackagePRRef>();
  for (const entry of prs) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    if (
      typeof value["owner"] !== "string" ||
      value["owner"].trim().length === 0 ||
      typeof value["repo"] !== "string" ||
      value["repo"].trim().length === 0 ||
      typeof value["number"] !== "number" ||
      typeof value["url"] !== "string" ||
      value["url"].trim().length === 0
    ) {
      continue;
    }
    const normalized: WorkPackagePRRef = {
      owner: value["owner"].trim(),
      repo: value["repo"].trim(),
      number: value["number"],
      url: value["url"].trim(),
      ...(typeof value["projectId"] === "string" && value["projectId"].trim().length > 0
        ? { projectId: value["projectId"].trim() }
        : {}),
      ...(typeof value["sessionId"] === "string" && value["sessionId"].trim().length > 0
        ? { sessionId: value["sessionId"].trim() }
        : {}),
    };
    deduped.set(`${normalized.owner}/${normalized.repo}#${normalized.number}`, normalized);
  }
  return [...deduped.values()];
}

function buildWorkPackage(
  workPackageId: WorkPackageId,
  input: CreateWorkPackageInput,
  now: string,
): WorkPackage {
  const title = input.title.trim();
  if (title.length === 0) {
    throw new Error("Work package title is required");
  }
  const status = input.status ?? "planned";
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid work package status: "${status}"`);
  }
  return {
    version: WORK_PACKAGE_VERSION,
    id: workPackageId,
    title,
    ...(typeof input.description === "string" && input.description.trim().length > 0
      ? { description: input.description.trim() }
      : {}),
    status,
    blockers: normalizeBlockers(input.blockers ?? []),
    repositories: normalizeRepositories(input.repositories ?? []),
    sessions: normalizeSessions(input.sessions ?? []),
    prs: normalizePRs(input.prs ?? []),
    createdAt: now,
    updatedAt: now,
  };
}

function serializeWorkPackage(workPackage: WorkPackage): string {
  return `${JSON.stringify(workPackage, null, 2)}\n`;
}

function readWorkPackageFile(workPackageId: WorkPackageId): WorkPackage | null {
  const path = getWorkPackagePath(workPackageId);
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return parseWorkPackage(JSON.parse(content));
  } catch {
    return null;
  }
}

function writeWorkPackageFile(workPackage: WorkPackage): void {
  const path = getWorkPackagePath(workPackage.id);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, serializeWorkPackage(workPackage));
}

export function createWorkPackage(input: CreateWorkPackageInput): WorkPackage {
  const workPackageId = input.id?.trim() || randomUUID();
  assertValidWorkPackageId(workPackageId);
  const lockPath = `${getWorkPackagePath(workPackageId)}.lock`;
  return withFileLockSync(lockPath, () => {
    if (readWorkPackageFile(workPackageId)) {
      throw new Error(`Work package already exists: ${workPackageId}`);
    }
    const now = new Date().toISOString();
    const workPackage = buildWorkPackage(workPackageId, input, now);
    writeWorkPackageFile(workPackage);
    return workPackage;
  });
}

export function readWorkPackage(workPackageId: WorkPackageId): WorkPackage | null {
  assertValidWorkPackageId(workPackageId);
  return readWorkPackageFile(workPackageId);
}

export function updateWorkPackage(
  workPackageId: WorkPackageId,
  updates: UpdateWorkPackageInput,
): WorkPackage {
  assertValidWorkPackageId(workPackageId);
  const lockPath = `${getWorkPackagePath(workPackageId)}.lock`;
  return withFileLockSync(lockPath, () => {
    const current = readWorkPackageFile(workPackageId);
    if (!current) {
      throw new Error(`Work package not found: ${workPackageId}`);
    }
    const nextStatus = updates.status ?? current.status;
    if (!VALID_STATUSES.has(nextStatus)) {
      throw new Error(`Invalid work package status: "${nextStatus}"`);
    }
    const nextTitle = updates.title === undefined ? current.title : updates.title.trim();
    if (nextTitle.length === 0) {
      throw new Error("Work package title is required");
    }

    const updated: WorkPackage = {
      ...current,
      title: nextTitle,
      description:
        updates.description === undefined
          ? current.description
          : updates.description.trim().length > 0
            ? updates.description.trim()
            : undefined,
      status: nextStatus,
      blockers: updates.blockers === undefined ? current.blockers : normalizeBlockers(updates.blockers),
      repositories:
        updates.repositories === undefined ? current.repositories : normalizeRepositories(updates.repositories),
      sessions: updates.sessions === undefined ? current.sessions : normalizeSessions(updates.sessions),
      prs: updates.prs === undefined ? current.prs : normalizePRs(updates.prs),
      updatedAt: new Date().toISOString(),
    };
    writeWorkPackageFile(updated);
    return updated;
  });
}

export function listWorkPackages(): WorkPackage[] {
  const dir = getWorkPackagesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(JSON_EXTENSION))
    .map((entry) => readWorkPackage(entry.slice(0, -JSON_EXTENSION.length)))
    .filter((entry): entry is WorkPackage => entry !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
