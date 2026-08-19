import type { TaskEnvelope } from "@agent-relay/protocol";

/**
 * Build the prompt handed to the local agent runtime. The consumer decides
 * the context; the relay never inspects it; the provider answers from it.
 */
export function buildTaskPrompt(task: TaskEnvelope): string {
  const lines: string[] = [];
  lines.push("You are acting as a remote expert agent on the Agent Relay network.");
  lines.push("A consumer agent delegated the following task to you.");
  lines.push("Work ONLY from the context provided below. You may not interact");
  lines.push("with the consumer. Produce your final answer directly.");
  lines.push("");
  lines.push("## Goal");
  lines.push(task.goal);
  if (task.type) {
    lines.push("");
    lines.push(`## Task type\n${task.type}`);
  }
  if (task.capabilities.length) {
    lines.push("");
    lines.push(`## Required capabilities\n${task.capabilities.join(", ")}`);
  }
  const ctx = task.context;
  if (ctx?.environment && Object.keys(ctx.environment).length) {
    lines.push("");
    lines.push("## Environment");
    for (const [k, v] of Object.entries(ctx.environment)) lines.push(`- ${k}: ${v}`);
  }
  if (ctx?.files?.length) {
    lines.push("");
    lines.push("## Files");
    for (const f of ctx.files) {
      lines.push("");
      lines.push(`### ${f.path}`);
      lines.push("```");
      lines.push(f.content);
      lines.push("```");
    }
  }
  if (ctx?.logs?.length) {
    lines.push("");
    lines.push("## Logs");
    for (const log of ctx.logs) lines.push("```\n" + log + "\n```");
  }
  if (ctx?.previous_attempts?.length) {
    lines.push("");
    lines.push("## Previous attempts");
    for (const a of ctx.previous_attempts) lines.push(`- ${a}`);
  }
  if (task.requirements?.output) {
    lines.push("");
    lines.push(`## Required output format\n${task.requirements.output}`);
  }
  if (task.requirements?.max_tokens) {
    lines.push("");
    lines.push(`Keep your answer within roughly ${task.requirements.max_tokens} tokens.`);
  }
  lines.push("");
  lines.push(
    "Structure your answer as: a one-paragraph summary, then your detailed analysis,",
    "then a concrete recommendation.",
  );
  return lines.join("\n");
}
