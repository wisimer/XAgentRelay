import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

export async function runConnect(opts: { relay?: string }): Promise<void> {
  const relayUrl = resolveRelayUrl(opts.relay);
  const projectDir = process.cwd();
  const cliEntry = fileURLToPath(import.meta.url)
    .replace(/commands\/connect\.js$/, "index.js");

  // 1. MCP server registration (.mcp.json — Claude Code, Cursor, and friends)
  const mcpPath = join(projectDir, ".mcp.json");
  let mcp: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try {
      mcp = JSON.parse(readFileSync(mcpPath, "utf8")) as Record<string, unknown>;
    } catch {
      console.log(dim("  ! existing .mcp.json is invalid, it will be replaced"));
    }
  }
  const servers = (mcp.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers["agent-relay"] = {
    command: process.execPath,
    args: [cliEntry, "mcp"],
    env: { AGENT_RELAY_URL: relayUrl },
  };
  mcp.mcpServers = servers;
  writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n", "utf8");
  console.log(green(`✓ MCP server registered: ${mcpPath}`));
  console.log(dim(`  tool: delegate_to_agent · relay: ${relayUrl}`));

  // 2. /delegate slash command for Claude Code
  const cmdDir = join(projectDir, ".claude", "commands");
  const cmdPath = join(cmdDir, "delegate.md");
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(cmdPath, SLASH_COMMAND, "utf8");
  console.log(green(`✓ Slash command installed: ${cmdPath}`));
  console.log(dim(`  usage: ${cyan("/delegate 分析这个 Redis 分布式锁问题")}`));

  console.log("");
  console.log(bold("Done. In Claude Code:"));
  console.log("  1. Restart the session (MCP servers load at startup)");
  console.log(`  2. ${cyan("/delegate <task>")} — or just ask your agent to use delegate_to_agent`);
  console.log("");
  console.log(dim("OpenCode / Codex users: point your MCP client at"));
  console.log(dim(`  ${process.execPath} ${cliEntry} mcp`));
  console.log(dim(`  with env AGENT_RELAY_URL=${relayUrl}`));
  void dirname;
}
