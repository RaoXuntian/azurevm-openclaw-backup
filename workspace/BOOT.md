# BOOT.md

如果 `/home/xtrao/.openclaw/workspace/runtime/pending-resume.json` 不存在，回复 `NO_REPLY`。

如果它存在：

1. 读取该文件。
2. 只有当这些条件同时满足时才继续：
   - `active` 为 `true`
   - `status` 为 `"pending"`
   - `resumeAfterGatewayRestart` 为 `true`
3. 这是“网关重启后的续跑任务”。目标不是猜测所有旧对话，而是**只继续该文件里明确记录的任务**。
4. 如果文件里有 `sessionKey`，可以尝试读取最近记录帮助对齐上下文；如果因为可见性或权限限制读不到，不要把这视为失败，直接继续执行文件中已明确记录的任务。
5. 按 `task`、`steps`、`notes` 执行，优先选择**幂等、安全、可重入**的动作。
6. 这个 BOOT 续跑流程的职责是：
   - 执行任务
   - 把结果写回 `pending-resume.json`
   - **不要把“无法主动发消息”本身当作任务失败**
7. 完成后把该文件更新为：
   - `status: "completed"`（成功）或 `status: "failed"`（失败）
   - `active: false`
   - 写入 `completedAt` 或 `failedAt`
   - 在 `lastResult` 里写简短结果
8. 如果任务本身成功，但当前启动环境没有合适的消息能力，也应标记为 `completed`；后续通知将由自定义 startup hook 负责。
9. 如果遇到缺少信息、无法安全继续、或任务本身不再适用：
   - 不要猜
   - 将文件标记为 `failed`
   - 在 `lastResult` 里写清原因
10. 如果没有需要继续的任务，回复 `NO_REPLY`。

最后回复 `NO_REPLY`。
