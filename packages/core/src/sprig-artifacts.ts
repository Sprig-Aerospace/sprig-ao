import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

export type SprigArtifactKind = "state" | "readiness" | "status" | "log" | "evidence";

export interface SprigArtifactRecord {
  kind: SprigArtifactKind;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number | null;
}

export interface SprigArtifactCollection {
  artifacts: SprigArtifactRecord[];
  missingPaths: string[];
  errors: string[];
}

const KNOWN_ROOT_PATHS = [
  ".sprig",
  ".sprig/status",
  ".sprig/logs",
  ".sprig/evidence",
  "status",
  "logs",
  "evidence",
  "artifacts",
] as const;

const EVIDENCE_EXTENSIONS = new Set([".zip", ".tar", ".tgz", ".gz", ".jsonl"]);
const LOG_EXTENSIONS = new Set([".log", ".txt", ".out", ".err"]);
const STATUS_BASENAMES = new Set(["status", "status.txt", "status.json"]);
const READINESS_BASENAMES = new Set([
  "ready",
  "ready.txt",
  "ready.json",
  "readiness",
  "readiness.txt",
  "readiness.json",
]);
const MAX_SCAN_DEPTH = 3;

function normalizeRelativePath(rootPath: string, targetPath: string): string {
  const rel = relative(rootPath, targetPath);
  return rel === "" ? "." : rel;
}

function classifyArtifact(targetPath: string, isDirectory: boolean): SprigArtifactKind | null {
  const name = basename(targetPath).toLowerCase();
  const extension = extname(name);

  if (!isDirectory && name.endsWith(".state")) {
    return "state";
  }
  if (!isDirectory && READINESS_BASENAMES.has(name)) {
    return "readiness";
  }
  if (!isDirectory && STATUS_BASENAMES.has(name)) {
    return "status";
  }
  if (!isDirectory && (name.endsWith(".log") || LOG_EXTENSIONS.has(extension))) {
    return "log";
  }
  if (
    name.includes("evidence") ||
    extension === ".bundle" ||
    EVIDENCE_EXTENSIONS.has(extension) ||
    (isDirectory && name === "evidence")
  ) {
    return "evidence";
  }

  return null;
}

function appendArtifact(
  collection: SprigArtifactCollection,
  rootPath: string,
  targetPath: string,
  kind: SprigArtifactKind,
  isDirectory: boolean,
): void {
  try {
    const stats = statSync(targetPath);
    collection.artifacts.push({
      kind,
      path: targetPath,
      relativePath: normalizeRelativePath(rootPath, targetPath),
      isDirectory,
      sizeBytes: isDirectory ? null : stats.size,
    });
  } catch (error) {
    collection.errors.push(
      `Failed to stat ${normalizeRelativePath(rootPath, targetPath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function scanPath(
  collection: SprigArtifactCollection,
  rootPath: string,
  targetPath: string,
  depth: number,
  seenPaths: Set<string>,
): void {
  if (depth > MAX_SCAN_DEPTH || seenPaths.has(targetPath)) {
    return;
  }
  seenPaths.add(targetPath);

  let stats;
  try {
    stats = statSync(targetPath);
  } catch (error) {
    collection.errors.push(
      `Failed to inspect ${normalizeRelativePath(rootPath, targetPath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const kind = classifyArtifact(targetPath, stats.isDirectory());
  if (kind) {
    appendArtifact(collection, rootPath, targetPath, kind, stats.isDirectory());
  }

  if (!stats.isDirectory()) {
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(targetPath);
  } catch (error) {
    collection.errors.push(
      `Failed to read ${normalizeRelativePath(rootPath, targetPath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  for (const entry of entries) {
    if (entry === ".git" || entry === "node_modules") {
      continue;
    }
    scanPath(collection, rootPath, join(targetPath, entry), depth + 1, seenPaths);
  }
}

export function collectSprigArtifacts(rootPath: string): SprigArtifactCollection {
  const collection: SprigArtifactCollection = {
    artifacts: [],
    missingPaths: [],
    errors: [],
  };

  const seenPaths = new Set<string>();

  scanPath(collection, rootPath, rootPath, 0, seenPaths);

  for (const relativePath of KNOWN_ROOT_PATHS) {
    const absolutePath = join(rootPath, relativePath);
    if (!existsSync(absolutePath)) {
      collection.missingPaths.push(relativePath);
      continue;
    }
    scanPath(collection, rootPath, absolutePath, 0, seenPaths);
  }

  collection.artifacts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  collection.missingPaths.sort((a, b) => a.localeCompare(b));
  collection.errors.sort((a, b) => a.localeCompare(b));

  return collection;
}
