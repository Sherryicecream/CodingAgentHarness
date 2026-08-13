# Windows CLI 清理修复设计

## 问题

普通 Windows PowerShell 运行 `npm.cmd test --workspace @harness/cli` 时，清理回归用例留下 detached Node Server，端口 31109 持续监听；后续 packed CLI 用例也在 15 秒健康检查窗口内失败。独立复跑 packed CLI 已通过，且干净安装中的 Core/Server import 与 `startServer()` 均能快速完成，因此当前确定性缺陷是测试 fixture 清理，而不是产品 Server 启动。

## 方案选择

1. **推荐：fixture 按精确 PID 使用 Node `process.kill(..., 'SIGKILL')` 清理。** 保留测试对生产清理逻辑的失败断言，只修复测试自身 finally，Windows 和其他平台均可使用，并由端口关闭断言验证。
2. 继续依赖 `taskkill /t /f`：当前最小复现会卡住或无法关闭 detached Server，不采用。
3. 删除清理回归用例：会丢失 Windows 子进程泄漏证据，不采用。

## 范围

- 修改 `packages/cli/test/installed-runtime.test.mjs` 的 fixture 最终清理。
- 不修改 CLI 产品代码、Server 生命周期、安全模型或端口策略。
- 先修复确定性清理缺陷，再运行完整 4 项 suite。只有 packed CLI 仍失败时才单独设计第二修复。

## 验收

- 已有清理用例从 RED 变为 GREEN。
- 完整 CLI suite 4/4 通过并正常退出。
- 31000–31999 范围不遗留该测试启动的监听进程。
- typecheck、package verification 和文档一致性不回归。

## 已批准

用户在看到根因、最小修复顺序和文件范围后明确回复“批准”。
