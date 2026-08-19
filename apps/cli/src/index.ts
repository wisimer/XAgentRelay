#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runRegister } from "./commands/register.js";
import { runServe } from "./commands/serve.js";
import { runDelegate } from "./commands/delegate.js";
import { runStatus } from "./commands/status.js";
import { runTasks } from "./commands/tasks.js";
import { runConnect } from "./commands/connect.js";
import { runLogin } from "./commands/login.js";
import { runMcpServer } from "./commands/mcp.js";

const program = new Command();

program
  .name("agent-relay")
  .description("Let your agent call other agents like tools")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize ~/.agent-relay (config, identity, agent profile)")
  .option("--role <role>", "provide | use | both")
  .option("--name <name>", "your name")
  .option("--agent-name <name>", "display name of your agent")
  .option("--caps <list>", "comma separated capabilities, e.g. rust,debugging")
  .option("--runtime <runtime>", "claude-code | opencode | codex | mock")
  .option("--relay <url>", "relay server url")
  .action(runInit);

program
  .command("register")
  .description("Register this machine's agent with the relay")
  .option("--relay <url>", "relay server url")
  .option("--name <name>", "override agent name")
  .option("--runtime <runtime>", "override runtime")
  .option("--caps <list>", "override capabilities")
  .action(runRegister);

program
  .command("serve")
  .description("Go online as a provider and wait for delegated tasks")
  .option("--relay <url>", "relay server url")
  .action(runServe);

program
  .command("delegate <goal...>")
  .description("Delegate a task to an agent on the network")
  .option("--relay <url>", "relay server url")
  .option("--cap <list...>", "required capabilities (repeatable or comma separated)")
  .option("--file <path...>", "files to include as context (repeatable)")
  .option("--log <line...>", "log lines to include (repeatable)")
  .option("--env <kv...>", "environment info as key=value (repeatable)")
  .option("--type <type>", "task type, e.g. debugging")
  .option("--timeout <seconds>", "task timeout in seconds")
  .option("--max-tokens <n>", "hint for max output tokens")
  .action(runDelegate);

program
  .command("connect")
  .description("Wire delegate_to_agent + /delegate into your coding agent (MCP)")
  .option("--relay <url>", "relay server url")
  .action(runConnect);

program
  .command("login <url>")
  .description("Point this machine at a relay server")
  .action(runLogin);

program
  .command("status")
  .description("Show relay connectivity and this machine's agent")
  .option("--relay <url>", "relay server url")
  .action(runStatus);

program
  .command("tasks")
  .description("List delegated / served tasks")
  .option("--relay <url>", "relay server url")
  .option("--all", "show all tasks on the relay")
  .action(runTasks);

program
  .command("mcp", { hidden: true })
  .description("Run as an MCP stdio server (used by coding agents)")
  .action(runMcpServer);

program.parseAsync(process.argv);
