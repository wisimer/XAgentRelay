# chore: 提交并推送遗留的 CLI 版本号变更（tkt_7979de4f3b69）

- 时间：2026-09-20 16:30:17
- 工单：tkt_7979de4f3b69（issue：根据修改的文件 commit 并 push）

## 背景

上一次功能提交 e589798（feat: serve workspace mode + standalone ticket board page）后，工作树中遗留了一处未提交变更：`apps/cli/package.json` 的 `version` 从 `0.1.20` 改为 `0.1.21`。工单要求将修改的文件 commit 并 push。

## 处理过程

1. `git status` / `git diff` 确认唯一变更为 CLI 版本号 bump（0.1.20 → 0.1.21），无其他未跟踪或已修改文件。
2. 提交该变更：`chore(cli): bump version to 0.1.21`（commit 1f44d89）。
3. 沉淀本文档并更新 `doc/index.md`。
4. `git push` 同步到 `origin/main`。

## 结论

版本号变更已随本任务提交并推送，`main` 分支与 `origin/main` 恢复一致，工作树干净。
