import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { bold, cyan, dim, green, resolveRelayUrl } from "../util.js";

const SLASH_COMMAND = `---
description: Delegate a subtask to another agent on the Agent Relay network
---

Delegate the following request to a remote expert agent via the \`delegate_to_agent\` MCP tool:

$ARGUMENTS

Steps:
1. Decide which capabilities the task requires (e.g. typescript, rust, debugging).
2. Gather relevant context: file contents, logs, environment info. You decide what to share.
3. Call \`delegate_to_agent\` with { task, capabilities, files?, logs?, environment? }.
4. When the result returns, review it and continue your own work with the new information.
`;

/** Trae/Cursor-style IDEs have no markdown slash commands — a project rule emulates /delegate. */
const TRAE_RULE = `

## Agent Relay /delegate

When the user's message starts with \`/delegate \`, delegate the rest of the message as a
subtask to a remote expert agent on the Agent Relay network, using the CLI:

\`\`\`bash
x-agent-relay delegate "<the user's text after /delegate>" --cap <inferred-caps> [--file <relevant-path>]
\`\`\`

- Infer \`--cap\` from the task (e.g. typescript, rust, debugging, mock); attach \`--file\` /
  \`--log\` context when it helps.
- The CLI streams the remote agent's live output and prints the final
  summary / analysis / recommendation — read it, then continue the user's work with it.
- If the \`delegate_to_agent\` MCP tool (server: x-agent-relay) is available, you may use
  it instead of the CLI.
`;

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(path: string, value: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function runConnect(opts: { relay?: string }): Promise<void> {
  const relayUrl = resolveRelayUrl(opts.relay);
  const projectDir = process.cwd();
  const cliEntry = fileURLToPath(import.meta.url)
    .replace(/commands\/connect\.js$/, "index.js");
  const serverDef = {
    command: process.execPath,
    args: [cliEntry, "mcp"],
    env: { AGENT_RELAY_URL: relayUrl },
  };

  // 1. MCP server registration (.mcp.json — Claude Code, Cursor, and friends)
  const mcpPath = join(projectDir, ".mcp.json");
  const mcp = readJson(mcpPath);
  const servers = (mcp.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers["x-agent-relay"] = serverDef;
  mcp.mcpServers = servers;
  writeJson(mcpPath, mcp);
  console.log(green(`✓ MCP server registered: ${mcpPath}`));
  console.log(dim(`  tool: delegate_to_agent · relay: ${relayUrl}`));

  // 2. /delegate slash command for Claude Code
  const cmdDir = join(projectDir, ".claude", "commands");
  const cmdPath = join(cmdDir, "delegate.md");
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(cmdPath, SLASH_COMMAND, "utf8");
  console.log(green(`✓ Slash command installed: ${cmdPath}`));

  // 3. IDE integrations (auto-detected)
  // Trae: chat MCP servers are managed by the IDE — print the paste snippet and
  // install a project rule so typing /delegate in chat routes to the MCP tool.
  const traeHome = [join(homedir(), ".trae"), join(homedir(), ".trae-cn")].find((d) => existsSync(d));
  if (traeHome) {
    const rulesDir = join(projectDir, ".trae", "rules");
    const rulesPath = join(rulesDir, "project_rules.md");
    mkdirSync(rulesDir, { recursive: true });
    const existing = existsSync(rulesPath) ? readFileSync(rulesPath, "utf8") : "";
    if (!existing.includes("Agent Relay /delegate")) {
      writeFileSync(rulesPath, existing + TRAE_RULE, "utf8");
    }
    console.log(green(`✓ Trae project rule installed: ${rulesPath}`));
    console.log(dim("  Trae → Settings → MCP → Add, then paste:"));
    console.log(dim(
      `  {"mcpServers":{"x-agent-relay":${JSON.stringify(serverDef)}}}`,
    ));
  }

  // Cursor: global ~/.cursor/mcp.json (same mcpServers format)
  if (existsSync(join(homedir(), ".cursor"))) {
    const cursorPath = join(homedir(), ".cursor", "mcp.json");
    const cursor = readJson(cursorPath);
    const cs = (cursor.mcpServers as Record<string, unknown> | undefined) ?? {};
    cs["x-agent-relay"] = serverDef;
    cursor.mcpServers = cs;
    writeJson(cursorPath, cursor);
    console.log(green(`✓ Cursor MCP server registered: ${cursorPath}`));
  }

  // VS Code (Copilot): workspace .vscode/mcp.json ("servers" format)
  const vscodeDir = join(projectDir, ".vscode");
  if (existsSync(vscodeDir)) {
    const vscodePath = join(vscodeDir, "mcp.json");
    const vscode = readJson(vscodePath);
    const vs = (vscode.servers as Record<string, unknown> | undefined) ?? {};
    vs["x-agent-relay"] = { type: "stdio", ...serverDef };
    vscode.servers = vs;
    writeJson(vscodePath, vscode);
    console.log(green(`✓ VS Code MCP server registered: ${vscodePath}`));
  }

  console.log("");
  console.log(bold("Done. In Claude Code / ZCode / Trae / Cursor:"));
  console.log("  1. Restart the session (MCP servers load at startup)");
  console.log(`  2. ${cyan("/delegate <task>")} — or just ask your agent to use delegate_to_agent`);
  console.log("");
  console.log(dim("Any other MCP client:"));
  console.log(dim(`  ${process.execPath} ${cliEntry} mcp   (env AGENT_RELAY_URL=${relayUrl})`));
}
