import {
  ACTIVITY_STATE,
  DEFAULT_ACTIVE_WINDOW_MS,
  DEFAULT_READY_THRESHOLD_MS,
  buildAgentPath,
  checkActivityLogState,
  getActivityFallbackState,
  isWindows,
  readLastActivityEntry,
  recordTerminalActivity,
  setupPathWrapperWorkspace,
  shellEscape,
  type ActivityDetection,
  type ActivityState,
  type Agent,
  type AgentLaunchConfig,
  type AgentSessionInfo,
  type PluginModule,
  type ProjectConfig,
  type RuntimeHandle,
  type Session,
  type WorkspaceHooksConfig,
} from "@aoagents/ao-core";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const manifest = {
  name: "jcode",
  slot: "agent" as const,
  description: "Agent plugin: J-Code CLI",
  version: "0.1.0",
  displayName: "J-Code",
};

interface JcodeDebugSession {
  id: string | null;
  cwd: string | null;
  summary: string | null;
  updatedAt: Date | null;
  costUsd: number | null;
}

function formatLaunchCommand(parts: string): string {
  return isWindows() ? `& ${parts}` : parts;
}

function appendCommonFlags(
  parts: string[],
  config: { workspacePath?: string | null; model?: string },
): void {
  parts.push("--no-update");
  if (config.workspacePath) {
    parts.push("-C", shellEscape(config.workspacePath));
  }
  if (config.model) {
    parts.push("-m", shellEscape(config.model));
  }
}

function promptFromConfig(config: AgentLaunchConfig): string | null {
  const chunks: string[] = [];
  if (config.systemPromptFile) {
    chunks.push(readFileSync(config.systemPromptFile, "utf-8"));
  } else if (config.systemPrompt) {
    chunks.push(config.systemPrompt);
  }
  if (config.prompt) chunks.push(config.prompt);
  return chunks.length > 0 ? chunks.join("\n\n---\n\n") : null;
}

function commandWithCommon(
  binary: string,
  subcommand: string,
  config: { workspacePath?: string | null; model?: string },
): string {
  const parts = [binary, subcommand];
  appendCommonFlags(parts, config);
  return parts.join(" ");
}

function createLaunchCommand(config: AgentLaunchConfig): string {
  const workspacePath = config.workspacePath ?? config.projectConfig.path;
  const common = { workspacePath, model: config.model };
  const serve = commandWithCommon("jcode", "serve", common);
  const connect = commandWithCommon("jcode", "connect", common);
  const repl = commandWithCommon("jcode", "repl", common);
  const prompt = promptFromConfig(config);
  const maybeRun = prompt
    ? `${commandWithCommon("jcode", "run", common)} ${shellEscape(prompt)}; `
    : "";

  // `jcode debug list` shows the shared socket when a daemon is already up.
  // If it is absent, start `jcode serve` in the background for this cwd. The
  // socket is global by default, while `-C/--cwd` scopes jcode's session state
  // to the AO worktree.
  if (isWindows()) {
    return formatLaunchCommand(`${maybeRun}${connect}`);
  }

  const logPath = shellEscape(join(tmpdir(), `ao-jcode-${config.sessionId}.log`));
  const ensureServer = `jcode debug list 2>/dev/null | grep -q running || (${serve} >${logPath} 2>&1 & sleep 1)`;
  return formatLaunchCommand(`${ensureServer}; ${maybeRun}exec ${connect} || exec ${repl}`);
}

function toComparablePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^([A-Z]):/, (match) => match.toLowerCase());
}

function getString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function getNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectSessionRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectSessionRecords(item));
  const record = asRecord(value);
  if (!record) return [];

  const nested = record["sessions"] ?? record["items"] ?? record["data"];
  if (Array.isArray(nested)) return nested.flatMap((item) => collectSessionRecords(item));
  return [record];
}

function parseJcodeDebugSessions(stdout: string, workspacePath: string): JcodeDebugSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  const wanted = toComparablePath(workspacePath);
  let best: JcodeDebugSession | null = null;
  for (const record of collectSessionRecords(parsed)) {
    const cwd = getString(record, ["cwd", "workdir", "workspace", "workspacePath", "path"]);
    if (!cwd || toComparablePath(cwd) !== wanted) continue;

    const updatedAt =
      parseDate(record["updated_at"]) ??
      parseDate(record["updatedAt"]) ??
      parseDate(record["last_activity_at"]) ??
      parseDate(record["lastActivityAt"]);
    const candidate: JcodeDebugSession = {
      id: getString(record, ["id", "session_id", "sessionId"]),
      cwd,
      summary: getString(record, ["title", "summary", "name", "prompt"]),
      updatedAt,
      costUsd: getNumber(record, ["cost_usd", "costUsd", "cost"]),
    };

    if (!best || (candidate.updatedAt?.getTime() ?? 0) > (best.updatedAt?.getTime() ?? 0)) {
      best = candidate;
    }
  }
  return best;
}

async function getDebugSession(workspacePath: string): Promise<JcodeDebugSession | null> {
  try {
    const { stdout } = await execFileAsync(
      "jcode",
      ["--no-update", "debug", "sessions", "-C", workspacePath],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    return parseJcodeDebugSessions(stdout, workspacePath);
  } catch {
    return null;
  }
}

async function newestJcodeFileMtime(workspacePath: string): Promise<Date | null> {
  const roots = [join(homedir(), ".jcode"), join(homedir(), ".local", "share", "jcode")];
  const wantedLeaf = basename(workspacePath);
  let newest: Date | null = null;

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let s: Awaited<ReturnType<typeof stat>>;
      try {
        s = await stat(fullPath);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        await scan(fullPath, depth + 1);
        continue;
      }
      if (!/\.(?:jsonl|json|log)$/.test(entry)) continue;
      if (!fullPath.includes(wantedLeaf)) continue;
      if (!newest || s.mtimeMs > newest.getTime()) newest = s.mtime;
    }
  }

  for (const root of roots) await scan(root, 0);
  return newest;
}

function classifyTimestamp(
  timestamp: Date,
  activeWindowMs: number,
  threshold: number,
): ActivityDetection {
  const ageMs = Math.max(0, Date.now() - timestamp.getTime());
  if (ageMs <= activeWindowMs) return { state: ACTIVITY_STATE.ACTIVE, timestamp };
  if (ageMs <= threshold) return { state: ACTIVITY_STATE.READY, timestamp };
  return { state: ACTIVITY_STATE.IDLE, timestamp };
}

function isProcessAliveByPid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

function argvMatchesJcode(argv: string[]): boolean {
  const head = argv[0] ?? "";
  return /(?:^|\/)\.?jcode$/.test(head);
}

function createJcodeAgent(): Agent {
  return {
    name: "jcode",
    processName: "jcode",

    getLaunchCommand(config: AgentLaunchConfig): string {
      return createLaunchCommand(config);
    },

    getEnvironment(config: AgentLaunchConfig): Record<string, string> {
      const env: Record<string, string> = {
        AO_SESSION_ID: config.sessionId,
        PATH: buildAgentPath(process.env["PATH"]),
      };
      if (config.issueId) env["AO_ISSUE_ID"] = config.issueId;
      return env;
    },

    detectActivity(terminalOutput: string): ActivityState {
      if (!terminalOutput.trim()) return ACTIVITY_STATE.IDLE;
      const lines = terminalOutput.trim().split("\n");
      const lastLine = lines[lines.length - 1]?.trim() ?? "";
      const tail = lines.slice(-8).join("\n");

      if (
        /\b(permission request|approval required|approve tool|allow (?:running|command|tool|edit|write))\b/i.test(
          tail,
        )
      ) {
        return ACTIVITY_STATE.WAITING_INPUT;
      }
      if (/\[(?:y|Y)\/(?:n|N)\]\s*$/m.test(tail)) return ACTIVITY_STATE.WAITING_INPUT;
      if (/\(y\)es.*\(n\)o/i.test(tail)) return ACTIVITY_STATE.WAITING_INPUT;
      if (/^\s*(?:error|fatal):/im.test(tail)) return ACTIVITY_STATE.BLOCKED;
      if (/\b(?:authentication failed|debug control is disabled|failed to connect)\b/i.test(tail)) {
        return ACTIVITY_STATE.BLOCKED;
      }
      if (/^(?:jcode[>.:]?|[>$#❯])\s*$/i.test(lastLine)) return ACTIVITY_STATE.IDLE;
      return ACTIVITY_STATE.ACTIVE;
    },

    async getActivityState(
      session: Session,
      readyThresholdMs?: number,
    ): Promise<ActivityDetection | null> {
      const threshold = readyThresholdMs ?? DEFAULT_READY_THRESHOLD_MS;
      const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);

      const exitedAt = new Date();
      if (!session.runtimeHandle) return { state: ACTIVITY_STATE.EXITED, timestamp: exitedAt };
      if (!(await this.isProcessRunning(session.runtimeHandle))) {
        return { state: ACTIVITY_STATE.EXITED, timestamp: exitedAt };
      }

      if (!session.workspacePath) return null;

      const activityResult = await readLastActivityEntry(session.workspacePath);
      const actionable = checkActivityLogState(activityResult);
      if (actionable) return actionable;

      const debugSession = await getDebugSession(session.workspacePath);
      if (debugSession?.updatedAt)
        return classifyTimestamp(debugSession.updatedAt, activeWindowMs, threshold);

      const nativeMtime = await newestJcodeFileMtime(session.workspacePath);
      if (nativeMtime) return classifyTimestamp(nativeMtime, activeWindowMs, threshold);

      const fallback = getActivityFallbackState(activityResult, activeWindowMs, threshold);
      if (fallback) return fallback;

      return null;
    },

    async recordActivity(session: Session, terminalOutput: string): Promise<void> {
      if (!session.workspacePath) return;
      await recordTerminalActivity(session.workspacePath, terminalOutput, (output) =>
        this.detectActivity(output),
      );
    },

    async isProcessRunning(handle: RuntimeHandle): Promise<boolean> {
      try {
        if (handle.runtimeName === "tmux" && handle.id) {
          if (isWindows()) return false;
          const { stdout: ttyOut } = await execFileAsync(
            "tmux",
            ["list-panes", "-t", handle.id, "-F", "#{pane_tty}"],
            { timeout: 30_000 },
          );
          const ttySet = new Set(
            ttyOut
              .trim()
              .split("\n")
              .map((tty) => tty.trim().replace(/^\/dev\//, ""))
              .filter(Boolean),
          );
          if (ttySet.size === 0) return false;
          const { stdout: psOut } = await execFileAsync("ps", ["-eo", "pid,tty,args"], {
            timeout: 30_000,
          });
          for (const line of psOut.split("\n")) {
            const cols = line.trimStart().split(/\s+/);
            if (cols.length < 3 || !ttySet.has(cols[1] ?? "")) continue;
            if (argvMatchesJcode(cols.slice(2))) return true;
          }
          return false;
        }

        const rawPid = handle.data["pid"];
        const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
        return Number.isFinite(pid) && pid > 0 ? isProcessAliveByPid(pid) : false;
      } catch {
        return false;
      }
    },

    async getSessionInfo(session: Session): Promise<AgentSessionInfo | null> {
      if (!session.workspacePath) return null;
      const debugSession = await getDebugSession(session.workspacePath);
      if (!debugSession) return null;
      return {
        summary: debugSession.summary,
        summaryIsFallback: debugSession.summary !== null,
        agentSessionId: debugSession.id,
        cost:
          debugSession.costUsd !== null
            ? { inputTokens: 0, outputTokens: 0, estimatedCostUsd: debugSession.costUsd }
            : undefined,
      };
    },

    async getRestoreCommand(session: Session, project: ProjectConfig): Promise<string | null> {
      const workspacePath = session.workspacePath ?? project.path;
      const model =
        typeof project.agentConfig?.model === "string" ? project.agentConfig.model : undefined;
      return commandWithCommon("jcode", "connect", { workspacePath, model });
    },

    async setupWorkspaceHooks(workspacePath: string, _config: WorkspaceHooksConfig): Promise<void> {
      await setupPathWrapperWorkspace(workspacePath);
    },
  };
}

export function create(): Agent {
  return createJcodeAgent();
}

export function detect(): boolean {
  try {
    const out = execFileSync("jcode", ["version", "--json"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 65_536,
    });
    return /"(?:version|semver)"\s*:/.test(out);
  } catch {
    return false;
  }
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;
