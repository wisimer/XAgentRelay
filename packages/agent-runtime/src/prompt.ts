import type { TaskEnvelope } from "@x-agent-relay/protocol";

export interface PromptOptions {
  /**
   * Absolute path of the provider's workspace. When set, the runtime runs
   * directly inside this directory with read/write access to it (and its
   * subdirectories) instead of answering from a sandboxed temp dir.
   */
  workspace?: string;
}

/**
 * Build the prompt handed to the local agent runtime. The consumer decides
 * the context; the relay never inspects it; the provider answers from it.
 */
export function buildTaskPrompt(task: TaskEnvelope, opts: PromptOptions = {}): string {
  const lines: string[] = [];
  if (opts.workspace) {
    lines.push("You are acting as a remote expert agent on the Agent Relay network.");
    lines.push("A consumer agent delegated the following task to you.");
    lines.push(`Your working directory is "${opts.workspace}" — the provider's workspace.`);
    lines.push("You have full read/write access to that directory and every file and");
    lines.push("subdirectory inside it. Perform all task operations there: read the");
    lines.push("existing code, make changes, run builds and tests as needed. Do NOT");
    lines.push("touch anything outside the workspace. You may not interact with the");
    lines.push("consumer. Produce your final answer directly.");
  } else {
    lines.push("You are acting as a remote expert agent on the Agent Relay network.");
    lines.push("A consumer agent delegated the following task to you.");
    lines.push("Work ONLY from the context provided below. You may not interact");
    lines.push("with the consumer. Produce your final answer directly.");
  }
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
  if (opts.workspace) {
    lines.push(
      "Structure your answer as: a one-paragraph summary of what you changed,",
      "then the files you touched and why, then any verification you ran.",
    );
  } else {
    lines.push(
      "Structure your answer as: a one-paragraph summary, then your detailed analysis,",
      "then a concrete recommendation.",
    );
  }
  return lines.join("\n");
}
