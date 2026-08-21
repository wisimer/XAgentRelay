import { defaultModelForRuntime } from "@x-agent-relay/agent-runtime";
import { RelayClient, RelayApiError } from "@x-agent-relay/sdk";
import {
  ensureIdentity,
  readAgentProfile,
  writeIdentity,
} from "@x-agent-relay/shared";
import { bold, dim, err, green, resolveRelayUrl, statusColor } from "../util.js";

export interface RegisterOptions {
  relay?: string;
  name?: string;
  runtime?: string;
  caps?: string;
  model?: string;
}

export async function runRegister(opts: RegisterOptions): Promise<void> {
  const baseUrl = resolveRelayUrl(opts.relay);
  const profile = readAgentProfile();
  const identity = ensureIdentity();

  const name = opts.name ?? profile?.name;
  const runtime = opts.runtime ?? profile?.runtime;
  // Model tag (provider/model): advertised as a capability so consumers can
  // route by model, and used as the default when they delegate without caps.
  const model = (opts.model ?? profile?.model ?? (runtime ? defaultModelForRuntime(runtime) : null))
    ?.trim()
    .toLowerCase();
  const capabilities = (
    opts.caps
      ? opts.caps.split(",")
      : (profile?.capabilities ?? ["coding"])
  ).map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (model && !capabilities.includes(model)) capabilities.push(model);

  if (!name || !runtime) {
    err("No agent profile found. Run `x-agent-relay init` first (or pass --name/--runtime).");
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
    if (model) console.log(`  ${bold("Model:")}    ${model}`);
    console.log(`  ${bold("Caps:")}     ${res.agent.capabilities.join(", ")}`);
    console.log(`  ${bold("Status:")}   ${statusColor(res.agent.status)}`);
    console.log(dim(`  Identity saved. Next: ${"x-agent-relay serve"} to go online.`));
  } catch (e) {
    if (e instanceof RelayApiError) err(`relay returned ${e.status}: ${e.message}`);
    else err(`cannot reach relay at ${baseUrl} (${(e as Error).message})`);
    process.exitCode = 1;
  }
}
