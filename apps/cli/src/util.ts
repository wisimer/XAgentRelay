import readline from "node:readline/promises";
import { DEFAULT_RELAY_URL } from "@x-agent-relay/protocol";
import { readConfig, writeConfig, type RelayConfig } from "@x-agent-relay/shared";

/* ------------------------------------------------------------------ output */

const wrap = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
export const bold = wrap("1");
export const dim = wrap("2");
export const green = wrap("32");
export const yellow = wrap("33");
export const red = wrap("31");
export const cyan = wrap("36");

export function statusColor(status: string): string {
  if (status === "online" || status === "completed") return green(status);
  if (status === "failed" || status === "timeout") return red(status);
  if (status === "busy" || ["pending", "assigned", "accepted", "running"].includes(status)) return yellow(status);
  return dim(status);
}

export const err = (msg: string) => console.error(red(`✗ ${msg}`));

export async function ask(question: string, fallback?: string): Promise<string> {
  // Non-interactive stdin (pipes, scripts, CI): fall back instead of hanging.
  if (!process.stdin.isTTY) {
    const value = fallback ?? "";
    console.log(dim(`${question} ${value}${value ? " (default)" : ""}`));
    return value;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} `)).trim();
    return answer || fallback || "";
  } finally {
    rl.close();
  }
}

/* ------------------------------------------------------------------- relay */

/** Resolve relay base URL: --relay flag > env > ~/.x-agent-relay/config.json > default. */
export function resolveRelayUrl(flag?: string): string {
  if (flag) return flag.replace(/\/$/, "");
  const env = process.env.AGENT_RELAY_URL;
  if (env) return env.replace(/\/$/, "");
  const config = readConfig();
  if (config?.relay) return config.relay.replace(/\/$/, "");
  return DEFAULT_RELAY_URL;
}

export function saveRelayUrl(url: string): void {
  const config: RelayConfig = { ...(readConfig() ?? { relay: url }), relay: url.replace(/\/$/, "") };
  writeConfig(config);
}
