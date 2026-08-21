import { userInfo } from "node:os";
import { defaultModelForRuntime, detectRuntimes } from "@x-agent-relay/agent-runtime";
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
} from "@x-agent-relay/shared";
import { ask, bold, cyan, dim, green } from "../util.js";

export interface InitOptions {
  role?: string;
  name?: string;
  agentName?: string;
  caps?: string;
  runtime?: string;
  model?: string;
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
  // Numeric menu like the role question above; mock is always choosable.
  const runtimeOptions = [...available.map((r) => r.runtime), "mock"];
  const defaultRuntimeNo = (available[0] ? runtimeOptions.indexOf(available[0].runtime) : runtimeOptions.length - 1) + 1;
  const runtimeAnswer =
    opts.runtime ??
    (await ask(
      `Runtime to expose ${runtimeOptions.map((r, i) => `[${i + 1}] ${r}`).join("  ")} (${defaultRuntimeNo})`,
      String(defaultRuntimeNo),
    ));
  const runtime = runtimeOptions[Number(runtimeAnswer) - 1] ?? runtimeAnswer;

  const ownerName = opts.name ?? (await ask("Your name:", userInfo().username));
  const defaultAgentName = `${ownerName}'s Agent (${runtime})`;
  const agentName = opts.agentName ?? (await ask("Agent name:", defaultAgentName));

  // Capabilities default to the model tag (provider/model): it is what a
  // bare /delegate matches on, and register broadcasts it for model routing.
  const modelDefault = defaultModelForRuntime(runtime) ?? "";
  const capsRaw =
    opts.caps ??
    opts.model ??
    (await ask(
      `Capabilities (comma separated${modelDefault ? `, model tag ${modelDefault}` : ", e.g. zhipu/glm"}):`,
      modelDefault || "coding",
    ));
  const capabilities = capsRaw.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  const modelRaw = opts.model ?? capabilities.find((c) => c.includes("/")) ?? (modelDefault || undefined);
  const model = modelRaw?.trim().toLowerCase() || undefined;

  const relayUrl = opts.relay ?? (await ask("Relay server URL, default https://agent.kreplay.com:", readConfig()?.relay ?? "https://agent.kreplay.com"));

  writeConfig({ ...(readConfig() ?? {}), relay: relayUrl.replace(/\/$/, "") });
  writeAgentProfile({ name: agentName, runtime, capabilities, ...(model ? { model } : {}) } satisfies AgentProfile);
  const identity = ensureIdentity();
  identity.name = ownerName;
  const { writeIdentity } = await import("@x-agent-relay/shared");
  writeIdentity(identity);

  console.log("");
  console.log(green(`✓ Config written to ${relayDir()}`));
  console.log(dim(`  ${configPath()}\n  ${identityPath()}\n  ${agentProfilePath()}`));
  console.log("");
  console.log(bold("Next steps:"));
  if (role !== "use") {
    console.log(`  ${cyan("x-agent-relay register")}   register this agent with the relay`);
    console.log(`  ${cyan("x-agent-relay serve")}      go online as a provider`);
  }
  if (role !== "provide") {
    console.log(`  ${cyan("x-agent-relay connect")}    wire /delegate into your coding agent`);
    console.log(`  ${cyan('x-agent-relay delegate "analyze this bug" --cap rust')}  one-shot delegation`);
  }
}
