import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
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

export interface RunOptions {
  /** Abort to kill the underlying runtime process (task cancelled upstream). */
  signal?: AbortSignal;
  /** Live stdout deltas as the runtime produces them (best-effort). */
  onChunk?: (text: string) => void;
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Run an agent CLI to completion.
 *
 * stdin is piped and closed immediately: agent CLIs (opencode in particular)
 * read stdin until EOF before starting, and execFile's default leaves that
 * pipe open until the child exits — a classic deadlock that hangs forever.
 * On timeout the child gets SIGTERM, then SIGKILL after 5s. Aborting kills
 * the child immediately.
 */
function runCli(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; signal?: AbortSignal; onChunk?: (text: string) => void },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveP, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let settled = false;
    const decoder = new StringDecoder("utf8");
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

    const abortHandler = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      reject(new Error("task cancelled by consumer"));
    };
    if (opts.signal) {
      if (opts.signal.aborted) abortHandler();
      else opts.signal.addEventListener("abort", abortHandler, { once: true });
    }

    const onData = (which: "stdout" | "stderr") => (chunk: Buffer) => {
      if (which === "stdout") {
        stdout += chunk;
        const text = decoder.write(chunk);
        if (text && opts.onChunk) {
          try {
            opts.onChunk(text);
          } catch {
            /* consumer-side chunk handling must never kill the run */
          }
        }
      } else stderr += chunk;
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
export async function runTask(
  task: TaskEnvelope,
  runtime: string,
  opts: RunOptions = {},
): Promise<RunOutcome> {
  if (runtime === "mock") return mockRun(task, opts.signal, opts.onChunk);

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
      // stream-json emits one NDJSON event per turn so consumers see progress
      // as it happens; the final {"type":"result"} line carries result+usage.
      const lines: ClaudeStreamEvent[] = [];
      let pending = "";
      const onEvent = (text: string) => {
        pending += text;
        let idx;
        while ((idx = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, idx).trim();
          pending = pending.slice(idx + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as ClaudeStreamEvent;
            lines.push(ev);
            const chunk = claudeEventChunk(ev);
            if (chunk) opts.onChunk?.(chunk);
          } catch {
            /* partial / non-JSON line — ignore */
          }
        }
      };
      const { stdout } = await runCli(
        "claude",
        ["-p", prompt, "--output-format", "stream-json", "--verbose"],
        { cwd: dir, timeoutMs, signal: opts.signal, onChunk: onEvent },
      );
      const tail = pending.trim();
      if (tail) {
        try {
          lines.push(JSON.parse(tail) as ClaudeStreamEvent);
        } catch {
          /* ignore */
        }
      }
      return parseClaudeStream(lines, stdout, task.goal);
    }
    if (runtime === "opencode") {
      const { stdout } = await runCli("opencode", ["run", prompt], {
        cwd: dir,
        timeoutMs,
        signal: opts.signal,
        onChunk: opts.onChunk,
      });
      return textRunOutcome(stdout, task.goal);
    }
    if (runtime === "codex") {
      const { stdout } = await runCli("codex", ["exec", prompt], {
        cwd: dir,
        timeoutMs,
        signal: opts.signal,
        onChunk: opts.onChunk,
      });
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

/* ------------------------------------------------- claude stream-json events */

interface ClaudeStreamEvent {
  type?: string;
  message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }> };
  result?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Render one stream-json event as a human-readable live chunk (or null). */
function claudeEventChunk(ev: ClaudeStreamEvent): string | null {
  if (ev.type !== "assistant") return null;
  const parts: string[] = [];
  for (const block of ev.message?.content ?? []) {
    if (block.type === "text" && block.text) parts.push(block.text + "\n");
    else if (block.type === "tool_use" && block.name) {
      const input = block.input ? JSON.stringify(block.input).slice(0, 120) : "";
      parts.push(`\n[tool: ${block.name}] ${input}\n`);
    }
  }
  return parts.length ? parts.join("") : null;
}

function parseClaudeStream(
  events: ClaudeStreamEvent[],
  stdout: string,
  goal: string,
): RunOutcome {
  const resultEvent = [...events].reverse().find((e) => e.type === "result");
  if (resultEvent) {
    const text = resultEvent.result ?? "";
    const usage: TaskUsage | undefined = resultEvent.usage
      ? {
          input_tokens: resultEvent.usage.input_tokens,
          output_tokens: resultEvent.usage.output_tokens,
        }
      : undefined;
    return { result: textRunOutcome(text, goal).result, usage, raw: text };
  }
  // Fallback: no parseable result event — treat raw stdout as the answer.
  return textRunOutcome(stdout, goal);
}

function textRunOutcome(text: string, goal: string): RunOutcome {
  const trimmed = text.trim();
  const summary = trimmed.split("\n").find((l) => l.trim().length > 0)?.slice(0, 280) ?? goal;
  return { result: { summary, output: trimmed }, raw: trimmed };
}

async function mockRun(
  task: TaskEnvelope,
  signal?: AbortSignal,
  onChunk?: (text: string) => void,
): Promise<RunOutcome> {
  const delayMs = Number(process.env.AGENT_RELAY_MOCK_DELAY_MS ?? 400);
  const caps = task.capabilities.join(", ") || "general";
  // Stream a few progress beats over the mock delay so consumers see liveness.
  const beats = [
    `[mock:${caps}] received task, reading context…\n`,
    `[mock:${caps}] analyzing goal: ${task.goal.slice(0, 60)}\n`,
    `[mock:${caps}] forming recommendation…\n`,
  ];
  for (const beat of beats) {
    onChunk?.(beat);
    await interruptibleSleep(delayMs / (beats.length + 1), signal);
  }
  await interruptibleSleep(delayMs / (beats.length + 1), signal);
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

function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("task cancelled by consumer"));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
