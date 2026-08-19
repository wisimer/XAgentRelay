import { userInfo } from "node:os";
import { detectRuntimes } from "@agent-relay/agent-runtime";
import {
  ensureIdentity,
  readConfig,
  writeAgentProfile,
  writeConfig,
  relayDir,
  configPath,
  identityPath,
  agentProfilePath,
  type AgentProfile,
} from "@agent-relay/shared";
import { ask, bold, cyan, dim, green } from "../util.js";

export interface InitOptions {
  role?: string;
  name?: string;
  agentName?: string;
  caps?: string;
  runtime?: string;
  relay?: string;
}

export async function runInit(opts: InitOptions): Promise<void> {
  console.log(bold("Welcome to Agent Relay"));
  console.log(dim("Let agents call other agents like tools.\n"));

  const roleAnswer = opts.role ?? (await ask("What do you want to do? [1] Provide my Agent  [2] Use other Agents  [3] Both (3)", "3"));
  const role = ["provide", "use", "both"][Number(roleAnswer) - 1] ?? "both";

  const detected = await detectRuntimes();
  const available = detected.filter((r) => r.available);
  console.log(
    dim(
      `Detected runtimes: ${detected.map((r) => `${r.runtime}${r.available ? " ✓" : " ✗"}`).join("  ")}`,
    ),
  );
  const defaultRuntime = available[0]?.runtime ?? "mock";
  const runtime =
    opts.runtime ?? (await ask(`Runtime to expose [${detected.map((r) => r.runtime).join("/")}], default ${defaultRuntime}`, defaultRuntime));

  const ownerName = opts.name ?? (await ask("Your name:", userInfo().username));
  const defaultAgentName = `${ownerName}'s Agent (${runtime})`;
  const agentName = opts.agentName ?? (await ask("Agent name:", defaultAgentName));

  const capsRaw = opts.caps ?? (await ask("Capabilities (comma separated):", "coding"));
  const capabilities = capsRaw.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);

  const relayUrl = opts.relay ?? (await ask("Relay server URL:", readConfig()?.relay ?? "http://127.0.0.1:8787"));

  writeConfig({ ...(readConfig() ?? {}), relay: relayUrl.replace(/\/$/, "") });
  writeAgentProfile({ name: agentName, runtime, capabilities } satisfies AgentProfile);
  const identity = ensureIdentity();
  identity.name = ownerName;
  const { writeIdentity } = await import("@agent-relay/shared");
  writeIdentity(identity);

  console.log("");
  console.log(green(`✓ Config written to ${relayDir()}`));
  console.log(dim(`  ${configPath()}\n  ${identityPath()}\n  ${agentProfilePath()}`));
  console.log("");
  console.log(bold("Next steps:"));
  if (role !== "use") {
    console.log(`  ${cyan("agent-relay register")}   register this agent with the relay`);
    console.log(`  ${cyan("agent-relay serve")}      go online as a provider`);
  }
  if (role !== "provide") {
    console.log(`  ${cyan("agent-relay connect")}    wire /delegate into your coding agent`);
    console.log(`  ${cyan('agent-relay delegate "analyze this bug" --cap rust')}  one-shot delegation`);
  }
}
