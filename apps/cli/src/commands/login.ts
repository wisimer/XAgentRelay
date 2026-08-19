import { RelayClient } from "@agent-relay/sdk";
import { green, dim, err, saveRelayUrl } from "../util.js";

export async function runLogin(url: string | undefined): Promise<void> {
  if (!url) {
    err("usage: agent-relay login <relay-url>   e.g. agent-relay login https://relay.example.com");
    process.exitCode = 1;
    return;
  }
  const baseUrl = url.replace(/\/$/, "");
  try {
    const health = await new RelayClient(baseUrl).health();
    saveRelayUrl(baseUrl);
    console.log(green(`✓ Connected to relay ${baseUrl}`));
    console.log(dim(`  protocol v${health.version} · uptime ${health.uptime_s}s`));
  } catch (e) {
    err(`cannot reach relay at ${baseUrl} (${(e as Error).message})`);
    process.exitCode = 1;
  }
}
