import { RelayClient, RelayApiError } from "@agent-relay/sdk";
import {
  ensureIdentity,
  readAgentProfile,
  writeIdentity,
} from "@agent-relay/shared";
import { bold, dim, err, green, resolveRelayUrl, statusColor } from "../util.js";

export interface RegisterOptions {
  relay?: string;
  name?: string;
  runtime?: string;
  caps?: string;
}

export async function runRegister(opts: RegisterOptions): Promise<void> {
  const baseUrl = resolveRelayUrl(opts.relay);
  const profile = readAgentProfile();
  const identity = ensureIdentity();

  const name = opts.name ?? profile?.name;
  const runtime = opts.runtime ?? profile?.runtime;
  const capabilities = (
    opts.caps
      ? opts.caps.split(",")
      : (profile?.capabilities ?? ["coding"])
  ).map((c) => c.trim().toLowerCase()).filter(Boolean);

  if (!name || !runtime) {
    err("No agent profile found. Run `agent-relay init` first (or pass --name/--runtime).");
    process.exitCode = 1;
    return;
  }

  const client = new RelayClient(baseUrl);
  try {
    const res = await client.registerAgent({
      name,
      runtime,
      capabilities,
      ownerId: identity.owner_id,
      ...(identity.agent_id ? { agentId: identity.agent_id } : {}),
    });
    identity.agent_id = res.agent_id;
    identity.token = res.token;
    writeIdentity(identity);

    console.log(green("✓ Agent registered"));
    console.log(`  ${bold("Agent ID:")}  ${res.agent_id}`);
    console.log(`  ${bold("Name:")}     ${res.agent.name}`);
    console.log(`  ${bold("Runtime:")}  ${res.agent.runtime}`);
    console.log(`  ${bold("Caps:")}     ${res.agent.capabilities.join(", ")}`);
    console.log(`  ${bold("Status:")}   ${statusColor(res.agent.status)}`);
    console.log(dim(`  Identity saved. Next: ${"agent-relay serve"} to go online.`));
  } catch (e) {
    if (e instanceof RelayApiError) err(`relay returned ${e.status}: ${e.message}`);
    else err(`cannot reach relay at ${baseUrl} (${(e as Error).message})`);
    process.exitCode = 1;
  }
}
