import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createActivitySignal,
  type AgentLaunchConfig,
  type RuntimeHandle,
  type Session,
} from "@aoagents/ao-core";

const {
  mockExecFileAsync,
  mockExecFileSync,
  mockReadLastActivityEntry,
  mockRecordTerminalActivity,
  mockSetupPathWrapperWorkspace,
  mockBuildAgentPath,
  mockIsWindows,
  mockReadFileSync,
  mockRealpath,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockReadLastActivityEntry: vi.fn().mockResolvedValue(null),
  mockRecordTerminalActivity: vi.fn().mockResolvedValue(undefined),
  mockSetupPathWrapperWorkspace: vi.fn().mockResolvedValue(undefined),
  mockBuildAgentPath: vi.fn((p: string | undefined) => `/home/test/.ao/bin:${p ?? ""}`),
  mockIsWindows: vi.fn(() => false),
  mockReadFileSync: vi.fn(() => "system instructions"),
  mockRealpath: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const execFile = Object.assign((..._args: unknown[]) => undefined, {
    [Symbol.for("nodejs.util.promisify.custom")]: mockExecFileAsync,
  });
  return { execFile, execFileSync: mockExecFileSync };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, readFileSync: mockReadFileSync };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, realpath: mockRealpath };
});

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readLastActivityEntry: mockReadLastActivityEntry,
    recordTerminalActivity: mockRecordTerminalActivity,
    setupPathWrapperWorkspace: mockSetupPathWrapperWorkspace,
    buildAgentPath: mockBuildAgentPath,
    isWindows: mockIsWindows,
  };
});

import { create, default as defaultExport, detect, manifest } from "./index.js";

function makeLaunchConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
  return {
    sessionId: "sess-1",
    projectConfig: {
      name: "proj",
      repo: "owner/repo",
      path: "/repo",
      defaultBranch: "main",
      sessionPrefix: "sa",
    },
    workspacePath: "/workspace/proj",
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    projectId: "proj",
    status: "working",
    activity: "active",
    activitySignal: createActivitySignal("valid", {
      activity: "active",
      source: "runtime",
      timestamp: new Date(),
    }),
    branch: "feat/36",
    issueId: "36",
    pr: null,
    workspacePath: "/workspace/proj",
    runtimeHandle: makeTmuxHandle(),
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

function makeTmuxHandle(id = "tmux-sess"): RuntimeHandle {
  return { id, runtimeName: "tmux", data: {} };
}

function makeProcessHandle(pid?: number): RuntimeHandle {
  return { id: "proc", runtimeName: "process", data: pid ? { pid } : {} };
}

function mockTmuxWithProcess(argv: string, found = true): void {
  mockExecFileAsync.mockImplementation((cmd: string) => {
    if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys001\n", stderr: "" });
    if (cmd === "ps") {
      return Promise.resolve({
        stdout: `  PID TT       ARGS\n  100 ttys001  ${found ? argv : "zsh"}\n`,
        stderr: "",
      });
    }
    return Promise.reject(new Error(`unexpected ${cmd}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadLastActivityEntry.mockResolvedValue(null);
  mockBuildAgentPath.mockImplementation((p: string | undefined) => `/home/test/.ao/bin:${p ?? ""}`);
  mockIsWindows.mockReturnValue(false);
  mockRealpath.mockRejectedValue(new Error("ENOENT"));
});

describe("manifest and exports", () => {
  it("has the expected manifest", () => {
    expect(manifest).toEqual({
      name: "jcode",
      slot: "agent",
      description: "Agent plugin: J-Code CLI",
      version: "0.1.0",
      displayName: "J-Code",
    });
  });

  it("create returns a complete agent shape", () => {
    const agent = create();
    expect(agent.name).toBe("jcode");
    expect(agent.processName).toBe("jcode");
    expect(typeof agent.getLaunchCommand).toBe("function");
    expect(typeof agent.getEnvironment).toBe("function");
    expect(typeof agent.detectActivity).toBe("function");
    expect(typeof agent.getActivityState).toBe("function");
    expect(typeof agent.recordActivity).toBe("function");
    expect(typeof agent.isProcessRunning).toBe("function");
    expect(typeof agent.getSessionInfo).toBe("function");
    expect(typeof agent.getRestoreCommand).toBe("function");
    expect(typeof agent.setupWorkspaceHooks).toBe("function");
  });

  it("default export satisfies plugin module shape", () => {
    expect(defaultExport.manifest).toBe(manifest);
    expect(defaultExport.create).toBe(create);
    expect(defaultExport.detect).toBe(detect);
  });
});

describe("getLaunchCommand", () => {
  const agent = create();

  it("starts/uses the warm server, sends a prompt through run, then connects", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Fix issue #36" }));
    expect(cmd).toContain("jcode debug list");
    expect(cmd).toContain("jcode serve --no-update -C '/workspace/proj'");
    expect(cmd).toContain("jcode run --no-update -C '/workspace/proj' 'Fix issue #36'");
    expect(cmd).toContain("exec jcode connect --no-update -C '/workspace/proj'");
  });

  it("falls back to repl if connect exits", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).toContain("|| exec jcode repl --no-update -C '/workspace/proj'");
  });

  it("includes model and combines system prompt file with user prompt", () => {
    mockReadFileSync.mockReturnValueOnce("System rules");
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ model: "gpt-5.5", systemPromptFile: "/tmp/sys.md", prompt: "Do it" }),
    );
    expect(cmd).toContain("-m 'gpt-5.5'");
    expect(cmd).toContain("System rules");
    expect(cmd).toContain("Do it");
  });

  it("uses PowerShell call operator on Windows", () => {
    mockIsWindows.mockReturnValue(true);
    expect(agent.getLaunchCommand(makeLaunchConfig())).toMatch(/^& /);
  });
});

describe("getEnvironment", () => {
  it("sets AO session vars and prepends the AO wrapper PATH", () => {
    const env = create().getEnvironment(makeLaunchConfig({ issueId: "36" }));
    expect(env["AO_SESSION_ID"]).toBe("sess-1");
    expect(env["AO_ISSUE_ID"]).toBe("36");
    expect(env["PATH"]).toContain(".ao/bin");
    expect(env["PATH"]).toContain(process.env["PATH"] ?? "");
  });
});

describe("detectActivity", () => {
  const agent = create();

  it("detects jcode prompts as idle", () => {
    expect(agent.detectActivity("ready\njcode> ")).toBe("idle");
    expect(agent.detectActivity("ready\n❯ ")).toBe("idle");
  });

  it("detects permission prompts as waiting_input", () => {
    expect(agent.detectActivity("Permission request: allow running git status? [y/N]")).toBe(
      "waiting_input",
    );
    expect(agent.detectActivity("Approve tool call? (y)es/(n)o")).toBe("waiting_input");
  });

  it("detects hard errors as blocked", () => {
    expect(agent.detectActivity("Error: Debug control is disabled")).toBe("blocked");
    expect(agent.detectActivity("fatal: authentication failed")).toBe("blocked");
  });

  it("treats other output as active", () => {
    expect(agent.detectActivity("Thinking...\nEditing files")).toBe("active");
  });
});

describe("isProcessRunning", () => {
  const agent = create();

  it("matches jcode and dot-prefixed .jcode on a tmux pane TTY", async () => {
    mockTmuxWithProcess("/Users/me/.local/bin/.jcode connect");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("does not match unrelated argv containing jcode later", async () => {
    mockTmuxWithProcess("cat jcode.log");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("returns true for process PID EPERM", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });
    expect(await agent.isProcessRunning(makeProcessHandle(123))).toBe(true);
    killSpy.mockRestore();
  });

  it("returns false when process is dead", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    });
    expect(await agent.isProcessRunning(makeProcessHandle(123))).toBe(false);
    killSpy.mockRestore();
  });

  it("returns false for tmux probing on Windows", async () => {
    mockIsWindows.mockReturnValue(true);
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });
});

describe("getActivityState cascade", () => {
  const agent = create();

  it("returns exited when process is dead", async () => {
    mockTmuxWithProcess("jcode", false);
    const result = await agent.getActivityState(makeSession());
    expect(result?.state).toBe("exited");
  });

  it("returns waiting_input from JSONL permission prompt", async () => {
    mockTmuxWithProcess("jcode connect");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "waiting_input", source: "terminal" },
      modifiedAt: new Date(),
    });
    expect((await agent.getActivityState(makeSession()))?.state).toBe("waiting_input");
  });

  it("returns blocked from JSONL error", async () => {
    mockTmuxWithProcess("jcode connect");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "blocked", source: "terminal" },
      modifiedAt: new Date(),
    });
    expect((await agent.getActivityState(makeSession()))?.state).toBe("blocked");
  });

  it("returns active from native signal when recent", async () => {
    mockTmuxWithProcess("jcode connect");
    mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys001\n", stderr: "" });
      if (cmd === "ps")
        return Promise.resolve({ stdout: "PID TT ARGS\n1 ttys001 jcode connect\n", stderr: "" });
      if (cmd === "jcode" && args.includes("sessions")) {
        return Promise.resolve({
          stdout: JSON.stringify({
            sessions: [{ id: "abc", cwd: "/workspace/proj", updated_at: new Date().toISOString() }],
          }),
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    expect((await agent.getActivityState(makeSession()))?.state).toBe("active");
  });

  it("returns active from JSONL fallback when native signal fails and entry is fresh", async () => {
    mockTmuxWithProcess("jcode connect");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "active", source: "terminal" },
      modifiedAt: new Date(),
    });
    expect((await agent.getActivityState(makeSession()))?.state).toBe("active");
  });

  it("returns idle from JSONL fallback with age decay", async () => {
    mockTmuxWithProcess("jcode connect");
    const old = new Date(Date.now() - 10 * 60_000);
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: old.toISOString(), state: "active", source: "terminal" },
      modifiedAt: old,
    });
    expect((await agent.getActivityState(makeSession(), 60_000))?.state).toBe("idle");
  });

  it("returns null when both signals are unavailable", async () => {
    mockTmuxWithProcess("jcode connect");
    expect(await agent.getActivityState(makeSession())).toBeNull();
  });
});

describe("recordActivity and hooks", () => {
  it("delegates recordActivity to core", async () => {
    const session = makeSession();
    await create().recordActivity?.(session, "Permission request: allow? [y/N]");
    expect(mockRecordTerminalActivity).toHaveBeenCalledWith(
      "/workspace/proj",
      "Permission request: allow? [y/N]",
      expect.any(Function),
    );
  });

  it("skips recordActivity without workspace", async () => {
    await create().recordActivity?.(makeSession({ workspacePath: null }), "output");
    expect(mockRecordTerminalActivity).not.toHaveBeenCalled();
  });

  it("setupWorkspaceHooks delegates to setupPathWrapperWorkspace", async () => {
    await create().setupWorkspaceHooks?.("/workspace/proj", { dataDir: "/data" });
    expect(mockSetupPathWrapperWorkspace).toHaveBeenCalledWith("/workspace/proj");
  });
});

describe("session info and restore", () => {
  it("returns null when jcode exposes nothing", async () => {
    expect(await create().getSessionInfo(makeSession())).toBeNull();
  });

  it("matches debug sessions using canonical real paths", async () => {
    mockRealpath.mockImplementation(async (pathValue: string) => {
      if (pathValue === "/tmp/workspace/proj") return "/private/tmp/workspace/proj";
      return pathValue;
    });
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({
        sessions: [
          {
            id: "abc",
            cwd: "/private/tmp/workspace/proj",
            title: "Canonical path session",
            updated_at: new Date().toISOString(),
          },
        ],
      }),
      stderr: "",
    });

    const info = await create().getSessionInfo(
      makeSession({ workspacePath: "/tmp/workspace/proj" }),
    );

    expect(info).toMatchObject({
      agentSessionId: "abc",
      summary: "Canonical path session",
      summaryIsFallback: true,
    });
  });

  it("extracts session id and summary from debug sessions when available", async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({
        sessions: [
          {
            id: "abc",
            cwd: "/workspace/proj",
            title: "Fix bug",
            updated_at: new Date().toISOString(),
          },
        ],
      }),
      stderr: "",
    });
    const info = await create().getSessionInfo(makeSession());
    expect(info).toMatchObject({
      agentSessionId: "abc",
      summary: "Fix bug",
      summaryIsFallback: true,
    });
  });

  it("returns connect restore command", async () => {
    const cmd = await create().getRestoreCommand?.(makeSession(), {
      name: "proj",
      repo: "o/r",
      path: "/repo",
      defaultBranch: "main",
      sessionPrefix: "sa",
      agentConfig: { model: "gpt-5.5" },
    });
    expect(cmd).toBe("jcode connect --no-update -C '/workspace/proj' -m 'gpt-5.5'");
  });
});

describe("detect", () => {
  it("returns true for jcode version output", () => {
    mockExecFileSync.mockReturnValue('{"version":"v0.11.6","semver":"0.11.6"}');
    expect(detect()).toBe(true);
  });

  it("returns false on missing binary", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(detect()).toBe(false);
  });
});
