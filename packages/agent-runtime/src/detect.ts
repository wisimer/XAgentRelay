import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface RuntimeInfo {
  runtime: string;
  bin: string;
  available: boolean;
  version: string | null;
}

const CANDIDATES: { runtime: string; bin: string }[] = [
  { runtime: "claude-code", bin: "claude" },
  { runtime: "opencode", bin: "opencode" },
  { runtime: "codex", bin: "codex" },
  { runtime: "copilot", bin: "copilot" },
  { runtime: "antigravity", bin: "agy" },
  { runtime: "kiro", bin: "kiro-cli" },
  { runtime: "trae-agent", bin: "trae-cli" },
  { runtime: "pi", bin: "pi" },
  { runtime: "hermes", bin: "hermes" },
  { runtime: "qoder", bin: "qoder" },
  { runtime: "zcode", bin: "zcode" },
];

/** Detect which coding-agent CLIs are installed on this machine. */
export async function detectRuntimes(): Promise<RuntimeInfo[]> {
  const results = await Promise.all(
    CANDIDATES.map(async ({ runtime, bin }) => {
      try {
        const { stdout } = await exec(bin, ["--version"], { timeout: 5000 });
        return { runtime, bin, available: true, version: stdout.trim().split("\n")[0] ?? null };
      } catch {
        return { runtime, bin, available: false, version: null };
      }
    }),
  );
  return results;
}

/** First available runtime, or "mock" if none installed. */
export async function detectDefaultRuntime(): Promise<string> {
  const runtimes = await detectRuntimes();
  return runtimes.find((r) => r.available)?.runtime ?? "mock";
}
