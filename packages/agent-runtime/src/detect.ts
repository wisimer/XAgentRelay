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

/**
 * Best-effort default model tag (provider/model) per runtime — the model family
 * each CLI ships with. Configure-runtimes (opencode, pi) have no single
 * default and return null; users set those via `init --model`.
 */
const DEFAULT_MODELS: Record<string, string> = {
  "claude-code": "anthropic/claude",
  codex: "openai/codex",
  zcode: "zhipu/glm",
  "trae-agent": "bytedance/trae",
  copilot: "github/copilot",
  antigravity: "google/gemini",
  kiro: "aws/kiro",
  qoder: "alibaba/qwen",
  hermes: "nous/hermes",
  mock: "mock/mock",
};

export function defaultModelForRuntime(runtime: string): string | null {
  return DEFAULT_MODELS[runtime] ?? null;
}
