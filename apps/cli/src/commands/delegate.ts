import { readFileSync } from "node:fs";
import { delegate, DelegationError, RelayClient } from "@x-agent-relay/sdk";
import type { TaskFile } from "@x-agent-relay/protocol";
import { ensureIdentity, readAgentProfile } from "@x-agent-relay/shared";
import { bold, cyan, dim, err, green, resolveRelayUrl, statusColor, yellow } from "../util.js";

export interface DelegateOptions {
  relay?: string;
  cap?: string[];
  file?: string[];
  log?: string[];
  env?: string[];
  type?: string;
  timeout?: string;
  maxTokens?: string;
}

/**
 * One-shot delegation: x-agent-relay delegate "analyze this bug" --cap rust --file src/auth.ts
 */
export async function runDelegate(goal: string[], opts: DelegateOptions): Promise<void> {
  if (!goal.length) {
    err("usage: x-agent-relay delegate <goal> [--cap c1,c2] [--file path]...");
    process.exitCode = 1;
    return;
  }
  const baseUrl = resolveRelayUrl(opts.relay);
  const identity = ensureIdentity();

  let capabilities = (opts.cap ?? []).flatMap((c) => c.split(",")).map((c) => c.trim().toLowerCase()).filter(Boolean);
  // No caps (or the "general" tag host agents tend to fill in) falls back to
  // this machine's model tag — the task routes to a same-model provider
  // instead of matching nothing.
  if (capabilities.length === 0 || (capabilities.length === 1 && capabilities[0] === "general")) {
    const model = readAgentProfile()?.model;
    if (model) capabilities = [model.toLowerCase()];
  }
  const files: TaskFile[] = (opts.file ?? []).map((path) => ({
    path,
    content: readFileSync(path, "utf8"),
  }));
  const logs = opts.log ?? [];
  const environment: Record<string, string> = {};
  for (const kv of opts.env ?? []) {
    const [k, ...rest] = kv.split("=");
    if (k) environment[k] = rest.join("=");
  }

  console.log(dim(`Searching agent network at ${baseUrl}...`));
  if (capabilities.length) console.log(dim(`Required capabilities: ${capabilities.join(", ")}`));

  // Interrupt handling: Ctrl+C / kill while waiting must propagate to the
  // provider, which kills the running runtime process on its side.
  const client = new RelayClient(baseUrl, { consumerId: identity.owner_id });
  let taskId: string | null = null;
  let interrupted = false;
  const onInterrupt = async (signal: string) => {
    if (interrupted) return;
    interrupted = true;
    if (taskId) {
      console.log(yellow(`\n  ${signal} received — cancelling task ${taskId}...`));
      try {
        await Promise.race([client.cancelTask(taskId), new Promise((r) => setTimeout(r, 3000))]);
        console.log(dim(`  task ${taskId} cancelled, provider notified`));
      } catch {
        console.log(dim("  could not reach relay to cancel; task may finish on its own"));
      }
    }
    process.exit(130);
  };
  process.once("SIGINT", () => void onInterrupt("SIGINT"));
  process.once("SIGTERM", () => void onInterrupt("SIGTERM"));

  let streamStarted = false;
  try {
    const task = await delegate({
      goal: goal.join(" "),
      capabilities,
      type: opts.type,
      context: files.length || logs.length || Object.keys(environment).length ? { files, logs, environment } : undefined,
      requirements: {
        ...(opts.timeout ? { timeout: Number(opts.timeout) } : {}),
        ...(opts.maxTokens ? { max_tokens: Number(opts.maxTokens) } : {}),
      },
      baseUrl,
      consumerId: identity.owner_id,
      onEvent: (ev) => {
        if (ev.type === "dispatched") {
          taskId = ev.task_id;
          const p = ev.provider;
          console.log(
            p
              ? green(`Found agent: ${bold(p.name)} (${p.runtime})${p.capabilities.length ? ` [${p.capabilities.join(", ")}]` : ""}`)
              : green("Dispatching..."),
          );
          console.log(dim(`  task ${ev.task_id} — running, this can take a while`));
        } else if (ev.type === "status") {
          if (!streamStarted) console.log(dim(`  status: ${ev.status}`));
        }
      },
      onChunk: (text) => {
        if (!streamStarted) {
          streamStarted = true;
          console.log(dim("\n  ── live output ──"));
        }
        process.stdout.write(dim(text));
      },
    });
    if (streamStarted) process.stdout.write("\n");

    const r = task.result!;
    console.log("");
    console.log(bold("━━━ Result ━━━"));
    console.log(`  ${bold("Provider:")} ${task.providerId}  ${dim(`(${statusColor(task.status)})`)}`);
    if (r.summary) console.log(`\n  ${bold("Summary:")}\n  ${r.summary}`);
    if (r.analysis) console.log(`\n  ${bold("Analysis:")}\n  ${wrapText(r.analysis)}`);
    if (r.recommendation) console.log(`\n  ${bold("Recommendation:")}\n  ${wrapText(r.recommendation)}`);
    if (r.output && r.output !== r.analysis && r.output.length > (r.summary?.length ?? 0) + 50) {
      console.log(`\n  ${bold("Full output:")}\n  ${wrapText(r.output)}`);
    }
    if (r.confidence != null) console.log(dim(`\n  confidence: ${r.confidence}`));
    if (task.usage) {
      const parts: string[] = [];
      if (task.usage.input_tokens != null) parts.push(`in ${task.usage.input_tokens} tok`);
      if (task.usage.output_tokens != null) parts.push(`out ${task.usage.output_tokens} tok`);
      if (task.completedAt && task.startedAt) parts.push(`${((task.completedAt - task.startedAt) / 1000).toFixed(1)}s`);
      if (parts.length) console.log(dim(`  usage: ${parts.join(" · ")}`));
    }
    console.log(dim(`\n  (also visible in the dashboard: ${baseUrl}/)`));
  } catch (e) {
    if (e instanceof DelegationError) {
      err(`${e.message}${e.task ? ` (task ${e.task.task_id}, status ${e.task.status})` : ""}`);
      if (e.code === "no_matching_agent") {
        console.log(dim("  tip: no online agent matched. Register one with `x-agent-relay register && x-agent-relay serve`."));
      }
    } else {
      err((e as Error).message);
    }
    process.exitCode = 1;
  }
}

function wrapText(text: string, width = 88): string {
  return text
    .split("\n")
    .map((line) => (line.length <= width ? line : line.slice(0, width) + "…"))
    .map((line) => "  " + line)
    .join("\n")
    .trimStart();
}

// keep cyan import used for potential future banner; silence unused warning
void cyan;
