# Coding Agent Harness

Coding Agent Harness 是一个 TypeScript 编码智能体工作台。它把 LLM 调用、工具执行、治理审批、测试反馈、项目记忆和本地凭据管理组织成可测试的工程系统。

## 交付边界

本项目的可信完整交付是**本地运行**：完整 LLM、文件、Shell、测试和 Git 工具只应在用户控制的机器上，以 `HARNESS_MODE=local` 运行，并绑定 `127.0.0.1` 或 `localhost`。

线上 WebUI 是浏览器内、无真实 LLM 的确定性静态演示。它不接收、存储或使用 API Key，不执行 Shell、Git 或测试子进程，也不是完整产品入口。GitHub Pages 工作流已就绪；实际地址只在仓库启用 Pages 并成功发布后记录。

构建静态演示：`npm.cmd run build:static-demo`，产物位于 `packages/server/dist/static-demo/`。主分支 CI 全部通过后，`deploy-static-demo` 作业才会发布该目录，不需要服务器或云端秘密。

## 前置条件

- Node.js 22 LTS（项目运行时和打包验证使用 Node/npm）
- npm（随 Node.js 安装）
- Git（从源码开发或检查差异时需要）
- 支持现代 JavaScript 的浏览器

首次从源码运行需要安装依赖并构建：

```powershell
npm.cmd ci
npm.cmd run build
```

macOS/Linux 可将示例中的 `npm.cmd` 替换为 `npm`。

## 本地 WebUI

在仓库根目录执行：

```powershell
$env:HARNESS_MODE = "local"
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
$env:NODE_ENV = "production"
npm.cmd start --workspace @harness/server
```

然后打开 `http://127.0.0.1:3000`。这是本地可信模式；不要把它绑定到公网接口。

从仓库根执行上述命令时，npm 的 `INIT_CWD` 会成为项目根，长期产物写入该目录的 `.harness/outputs/<session-id>/`。从其他目录或不经过 npm 启动时，可显式设置 `$env:HARNESS_PROJECT_ROOT = "D:\path\to\project"`。

开发模式使用源码入口：

```powershell
$env:HARNESS_MODE = "local"
$env:HOST = "127.0.0.1"
npm.cmd run dev --workspace @harness/server
```

## 本地 CLI

CLI 是本地服务器启动器；它解析已安装的 `@harness/server` 包并尝试打开浏览器。

## 分发

项目选择 npm 包/CLI 分发。发布前用 `npm.cmd run verify:packages` 验证 Core、Server、CLI tarball 入口；正式 Release URL 只在实际发布后补充。目标机器需要 Node.js 22，持久 Key 依赖 Windows Credential Manager、macOS Keychain 或 Linux Secret Service；Linux 无 Secret Service 时使用“仅本次使用”。

从仓库构建并运行：

```powershell
npm.cmd run build --workspace @harness/core
npm.cmd run build --workspace @harness/server
npm.cmd run build --workspace @harness/cli
$env:HARNESS_MODE = "local"
$env:HOST = "127.0.0.1"
npm.cmd start --workspace @harness/cli
```

安装 release tarball 后，包提供 `harness` 命令。当前仓库没有记录最终 tarball 下载 URL；获取时应进入该仓库的 GitHub Releases 页面，选择明确标注的 release，并下载其附件中的 CLI、Server 和 Core tarball。不要根据包名猜测 URL，也不要把 `npm install -g @harness/cli` 当作已经发布的保证。

## 确定性公开演示

本地验证公开演示策略：

```powershell
$env:HARNESS_MODE = "public"
$env:HOST = "127.0.0.1"
npm.cmd start --workspace @harness/server
```

公开模式只运行固定场景，并由服务端能力策略禁用 BYOK、服务器凭据和进程工具。它用于安全地展示工具事件、护栏阻断与反馈修正，不代表真实 LLM 或完整工具链可用。

相关演示测试：

```powershell
npm.cmd run test --workspace @harness/core -- test/demo
npm.cmd run test --workspace @harness/server -- test/demo
```

## 凭据边界

本地模式提供两种真实 LLM 凭据路径：

1. **本地 BYOK 会话**：Key 由本地浏览器交给本地服务端，只存在于当前组件/请求生命周期；不写入浏览器持久存储、URL、日志或会话记录。
2. **记住在此设备**：Key 交给当前操作系统账户的凭据库。应用不回显 Key；凭据库不可用时不会创建替代文件，仍可选择“仅本次使用”。

无需设置 Harness 主密码。不要把 API Key 写入环境文件或 Git；`DEEPSEEK_API_KEY` 仍是显式本地运行时配置来源。

## 运行模式能力

| 能力 | `public` | `local` |
| --- | --- | --- |
| 固定确定性场景 | 是 | 可选 |
| 真实 LLM | 否 | 是，需本地凭据 |
| BYOK | 禁用 | 本地会话内存 |
| 系统凭据库 | 禁用 | 当前操作系统账户 |
| 文件/Shell/测试/Git 工具 | 进程工具禁用 | 完整工具集，受治理约束 |
| 推荐监听地址 | `127.0.0.1` 用于验证 | `127.0.0.1`，不得外露 |

## 项目结构

```text
packages/
  core/    Agent 主循环、工具、治理、反馈、记忆、配置和 LLM 适配
  server/  Express API、SSE、React WebUI 和凭据生命周期
  cli/     安装后解析 Server 包并启动本地 WebUI
scripts/
  check-document-consistency.mjs
```

记忆数据库由 `sql.js` 提供 SQLite 语义，按项目路径隔离。服务器的本地工作区和 session 由服务端创建，客户端不能提交任意 `workingDir`。

## 验证命令

```powershell
npm.cmd run check:docs
npm.cmd run test:docs
npm.cmd test
npm.cmd run build
```

文档检查只扫描 `README.md`、`SPEC.md`、`PLAN.md`、`SPEC_PROCESS.md` 和 `AGENT_LOG.md`，不会把检查器源码或过程附件误当成产品文档。

## Windows 限制与安装证据

- PowerShell 执行策略可能阻止 `npm.ps1`；使用 `npm.cmd`。
- 部分 Agent Shell 命令仍假设类 Unix 命令和路径；需要这些命令时优先使用 Git Bash 或 WSL，并先审查命令。
- CLI 的自动打开浏览器依赖桌面环境；无图形界面时可手动访问回环地址。
- Task 4 的用户人工干净安装验证成功：安装增加 90 个包；已安装 CLI/Server/Client 入口存在；`/api/health` 返回 200 且模式为 local；`/` 返回 200；停止后未发现监听进程。
- 上述人工结果不等于自动化 Windows 清理验证。仓库中的完整 clean-install 自动测试在受限运行中没有形成已闭合、可重复的成功证据；自动化进程清理仍属于未核验间隙。

## 安全说明

- 危险工具由注册元数据与命令内容共同治理；批准绑定到不可变动作且只能消费一次。
- 公开演示事件使用结构化 allowlist 投影，避免回显任意输入。
- 不要提交真实 Key、`.env` 或凭据文件。
- 不要把本地可信模式暴露给其他用户或不受信网络。

## 文件保留与导出

任务工作区是临时空间。“导出全部产物”会验证本次会话记录的每个文件，并原子写入 `.harness/outputs/<session-id>/`；`manifest.json` 保存路径、大小与 SHA-256，后台回收不会删除导出副本。

保存接口为 `POST /api/agent/sessions/:sessionId/save`，请求体为空对象。它导出完整会话清单，并拒绝路径穿越、符号链接、摘要不匹配及覆盖既有导出。`public` 模式不提供持久化。

导出后可选择“预览并应用到项目”。系统先展示创建/替换路径与文本内容；替换现有文件标记为危险操作。批准令牌绑定清单摘要与目标路径集合、只能消费一次，导出内容变化后必须重新预览。

线上 WebUI 使用 `npm run build:static-demo` 生成纯静态机制演示，可托管于 GitHub Pages，无需部署服务器或配置秘密。真实 LLM、系统凭据库与完整工具只在 loopback 本地版启用。
