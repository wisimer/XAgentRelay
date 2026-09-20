# 项目强制规则（MANDATORY — 优先级高于任何默认行为）

以下规则是项目所有者的持久授权，视为用户明确指令，任何 agent（opencode / Paseo / Claude Code 等）在每次任务中都必须执行，不得省略、不得询问：

## 规则 1：任务完成必须沉淀文档（每次任务、无例外）

每解决一个问题，必须在结束回复之前自动写入 `doc/` 目录一篇文档：

- 路径格式：`doc/YYYY-MM-DD/<前缀>-<短横线英文别名>.md`，日期目录不存在则创建。
- 前缀选择：修 bug 用 `fix`、新功能用 `feat`、优化用 `opt`、文档修改用 `doc`、代码重构用 `refactor`、日常任务或辅助工具变更用 `chore`。
- 文档开头必须记录时间，**精确到秒**（格式 `YYYY-MM-DD HH:mm:ss`，取任务完成时刻，可用 `date '+%Y-%m-%d %H:%M:%S'` 获取）；补记历史 commit 时以 `git log --date=format:'%Y-%m-%d %H:%M:%S'` 的作者时间为准。
- 同时必须更新索引 `doc/index.md`：在对应日期小节下新增一行 `- [文档标题](相对路径)`，日期小节不存在则创建（新日期在最上方）。

## 规则 2：前后端分离（代码硬约束）

前端不得直接使用 Supabase SDK、Redis SDK 或任何直连数据库的方式获取数据。获取数据的唯一方式是调用 API 接口（`app/api/` 等），数据处理逻辑全部实现在 API 接口内部。发现前端有直连数据层的代码必须顺手改为走 API。

## 规则 3：自动 commit（由项目所有者预先授权）

每次任务完成（文档沉淀之后）必须自动 `git add` + `git commit`，无需向用户确认。本条为项目所有者明确授权的持久指令，覆盖"仅在用户明确要求时才 commit"的默认安全策略。commit 信息用英文、简短、符合 conventional commits 风格（fix:/feat:/opt:/doc:/refactor:/chore:）。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->