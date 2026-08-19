import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_TASK_TIMEOUT_S,
  type TaskEnvelope,
  type TaskResultPayload,
  type TaskUsage,
} from "@agent-relay/protocol";
import { buildTaskPrompt } from "./prompt.js";

export interface RunOutcome {
  result: TaskResultPayload;
  usage?: TaskUsage;
  raw: string;
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Run an agent CLI to completion.
 *
 * stdin is piped and closed immediately: agent CLIs (opencode in particular)
 * read stdin until EOF before starting, and execFile's default leaves that
 * pipe open until the child exits — a classic deadlock that hangs forever.
 * On timeout the child gets SIGTERM, then SIGKILL after 5s.
 */
function runCli(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveP, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let settled = false;
    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      reject(
        new Error(
          `${bin} timed out after ${Math.round(opts.timeoutMs / 1000)}s and was killed` +
            (stderr.trim() ? `\n${stderr.trim().slice(-400)}` : ""),
        ),
      );
    }, opts.timeoutMs);

    const onData = (which: "stdout" | "stderr") => (chunk: Buffer) => {
      if (which === "stdout") stdout += chunk;
      else stderr += chunk;
      if (!settled && stdout.length + stderr.length > MAX_OUTPUT_BYTES) {
        settled = true;
        clearTimeout(killTimer);
        child.kill("SIGKILL");
        reject(new Error(`${bin} produced too much output (>16MB) and was killed`));
      }
    };
    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      reject(new Error(`failed to start ${bin}: ${err.message}`));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code === 0) {
        resolveP({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${bin} exited with code ${code ?? signal}` +
              (stderr.trim() ? `\n${stderr.trim().slice(-400)}` : ""),
          ),
        );
      }
    });
  });
}

/**
 * Execute a delegated task with the local agent runtime.
 *
 * Context files are materialized inside a throwaway temp directory and the
 * runtime runs there — the provider machine's own files are never touched,
 * matching the MVP rule "remote expert analysis, not remote code edits".
 */
export async function runTask(task: TaskEnvelope, runtime: string): Promise<RunOutcome> {
  if (runtime === "mock") return mockRun(task);

  const prompt = buildTaskPrompt(task);
  const dir = mkdtempSync(join(tmpdir(), "agent-relay-task-"));
  try {
    for (const file of task.context?.files ?? []) {
      const safe = safeJoin(dir, file.path);
      if (!safe) continue;
      mkdirSync(dirname(safe), { recursive: true });
      writeFileSync(safe, file.content, "utf8");
    }
    const timeoutMs = (task.requirements?.timeout ?? DEFAULT_TASK_TIMEOUT_S) * 1000;

    if (runtime === "claude-code") {
      const { stdout } = await runCli("claude", ["-p", prompt, "--output-format", "json"], {
        cwd: dir,
        timeoutMs,
      });
      return parseClaudeOutput(stdout);
    }
    if (runtime === "opencode") {
      const { stdout } = await runCli("opencode", ["run", prompt], { cwd: dir, timeoutMs });
      return textRunOutcome(stdout, task.goal);
    }
    if (runtime === "codex") {
      const { stdout } = await runCli("codex", ["exec", prompt], { cwd: dir, timeoutMs });
      return textRunOutcome(stdout, task.goal);
    }
    throw new Error(`unsupported runtime: ${runtime}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Reject paths that escape the temp directory. */
function safeJoin(dir: string, relPath: string): string | null {
  const abs = resolve(dir, relPath);
  return abs.startsWith(dir) ? abs : null;
}

interface ClaudeJson {
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseClaudeOutput(stdout: string): RunOutcome {
  try {
    const parsed = JSON.parse(stdout) as ClaudeJson;
    const text = parsed.result ?? stdout;
    const usage: TaskUsage | undefined = parsed.usage
      ? {
          input_tokens: parsed.usage.input_tokens,
          output_tokens: parsed.usage.output_tokens,
        }
      : undefined;
    return { result: textRunOutcome(text, "").result, usage, raw: text };
  } catch {
    return textRunOutcome(stdout, "");
  }
}

function textRunOutcome(text: string, goal: string): RunOutcome {
  const trimmed = text.trim();
  const summary = trimmed.split("\n").find((l) => l.trim().length > 0)?.slice(0, 280) ?? goal;
  return { result: { summary, output: trimmed }, raw: trimmed };
}

async function mockRun(task: TaskEnvelope): Promise<RunOutcome> {
  await new Promise((r) => setTimeout(r, 400));
  const caps = task.capabilities.join(", ") || "general";
  return {
    result: {
      summary: `[mock:${caps}] Analysis complete for: ${task.goal}`,
      analysis:
        `This is a mock provider response. The task "${task.goal}" was received ` +
        `with required capabilities [${caps}]. In production this slot would ` +
        `contain the local agent runtime's real analysis.`,
      recommendation: "Install claude/opencode/codex and re-register to get real answers.",
      confidence: 0.42,
    },
    usage: { input_tokens: 128, output_tokens: 64 },
    raw: "mock output",
  };
}
