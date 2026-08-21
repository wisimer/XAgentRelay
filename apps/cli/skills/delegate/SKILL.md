---
name: delegate
description: 'Delegate a subtask to a remote expert agent on the Agent Relay network (agent-to-agent RPC). Use when the user types "/delegate <task>" or asks to delegate / hand off / 委派 / 委托 a subtask to another agent. Streams live output and returns summary / analysis / recommendation.'
allowed-tools: Bash
---

# Delegate a subtask to a remote expert agent

把用户的请求（`/delegate` 后面的文本，或用户描述的子任务）委派给 Agent Relay 网络上的远程专家 Agent，拿到结果后继续用户手头的工作。

## 首选：MCP 工具

如果 `delegate_to_agent` MCP 工具（server: `x-agent-relay`）可用，直接调用：

```json
{
  "task": "<任务描述，自包含、给足背景>",
  "capabilities": ["<从任务推断的能力，如 typescript, rust, debugging, mock>"],
  "files": [{ "path": "<相关文件路径>", "content": "<文件内容>" }],
  "logs": ["<相关日志>"],
  "environment": { "language": "<语言>", "framework": "<框架>" }
}
```

`files` / `logs` / `environment` 按需提供——只分享对任务有帮助的上下文。

## 兜底：CLI

MCP 工具不可用时，用 CLI（输出会实时流式返回）：

```bash
x-agent-relay delegate "<任务描述>" --cap <cap1>,<cap2> [--file <相关文件路径>] [--log <日志>]
```

## 工作流程

1. 从任务推断所需 capabilities（如 `typescript`、`rust`、`debugging`、`mock`）。
2. 收集相关上下文：文件内容、日志、环境信息——由你判断分享哪些。
3. 调用 MCP 工具或 CLI 发起委派，等待流式结果。
4. 拿到返回的 summary / analysis / recommendation 后，**基于它继续完成用户的工作**，不要只是转述。

## 注意

- 任务描述必须自包含：远程 Agent 看不到你的会话历史。
- 委派失败（无在线 Agent 匹配、Provider 执行失败）时，向用户报告原因，再自行完成任务作为兜底。
- 双向可中断：用户 Ctrl+C 会取消远程任务。
