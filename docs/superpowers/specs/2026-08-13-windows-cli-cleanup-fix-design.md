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

## 补充：packed-install cache 稳定性

### 复现证据

Pages 修复开始前的全仓基线连续两次卡在 packed CLI 用例：一次由内部 50 秒 `npm install` 超时返回 `status: null`，一次由整条测试的 60 秒上限取消。Core 297/297、Server 197/197 均通过，且测试后没有 31000–31999 监听端口。

分阶段诊断证明三个 tarball 内容有效：同一组 tarball 均成功安装 92 个包，但测试指定的全新空 cache 用时 17.9 秒并受 registry 波动影响；使用 npm 默认 cache 仅用时 3.5 秒。测试设置 `npm_config_prefer_offline=true` 的同时把 `npm_config_cache` 指向每次新建的空目录，因而无法复用先前 `npm ci` 已下载并完成完整性校验的包。

### 补充方案

1. **采用：删除测试专用的空 `npm_config_cache` 覆盖。** 保留全新安装目录、`prefer_offline`、`audit=false`、真实 tarball 安装和全部产品断言。
2. 不采用单纯扩大 50/60 秒超时：仍会重复下载并保留网络波动。
3. 不采用复制全局 cache 到隔离目录：增加跨平台路径和 npm cache 布局耦合。

### 补充范围与验收

- 只修改 `packages/cli/test/installed-runtime.test.mjs` 的 npm 环境；不修改 CLI、Server 或 WebUI 产品代码。
- 先使用现有连续超时结果作为 RED，只删除空 cache 覆盖，然后验证 focused packed 用例、CLI 4/4 与全仓测试。
- 若默认 cache 下仍然失败，不叠加超时修复，返回根因调查。
- 用户在看到诊断数据与三个方案后明确批准方案一。
