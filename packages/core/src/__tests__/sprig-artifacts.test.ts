import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { collectSprigArtifacts } from "../sprig-artifacts.js";

describe("collectSprigArtifacts", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createRoot(): string {
    const root = join(tmpdir(), `ao-sprig-artifacts-${randomUUID()}`);
    tempRoots.push(root);
    mkdirSync(root, { recursive: true });
    return root;
  }

  it("ingests known .state files", () => {
    const root = createRoot();
    mkdirSync(join(root, ".sprig"), { recursive: true });
    writeFileSync(join(root, "worker.state"), "running\n", "utf-8");
    writeFileSync(join(root, ".sprig", "status.state"), "ready\n", "utf-8");

    const result = collectSprigArtifacts(root);

    expect(
      result.artifacts
        .filter((artifact) => artifact.kind === "state")
        .map((artifact) => artifact.relativePath),
    ).toEqual([".sprig/status.state", "worker.state"]);
  });

  it("harvests readiness, status, logs, and evidence bundle conventions", () => {
    const root = createRoot();
    mkdirSync(join(root, ".sprig", "logs"), { recursive: true });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, ".sprig", "readiness.json"), '{"ok":true}\n', "utf-8");
    writeFileSync(join(root, "status.json"), '{"state":"ready"}\n', "utf-8");
    writeFileSync(join(root, ".sprig", "logs", "worker.log"), "hello\n", "utf-8");
    writeFileSync(join(root, "evidence", "bundle.zip"), "zip\n", "utf-8");

    const result = collectSprigArtifacts(root);
    const byKind = new Map(
      result.artifacts.map((artifact) => [artifact.relativePath, artifact.kind]),
    );

    expect(byKind.get(".sprig/readiness.json")).toBe("readiness");
    expect(byKind.get("status.json")).toBe("status");
    expect(byKind.get(".sprig/logs/worker.log")).toBe("log");
    expect(byKind.get("evidence")).toBe("evidence");
    expect(byKind.get("evidence/bundle.zip")).toBe("evidence");
  });

  it("fails gracefully when known paths are missing", () => {
    const root = createRoot();

    const result = collectSprigArtifacts(root);

    expect(result.artifacts).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.missingPaths).toEqual([
      ".sprig",
      ".sprig/evidence",
      ".sprig/logs",
      ".sprig/status",
      "artifacts",
      "evidence",
      "logs",
      "status",
    ]);
  });
});
