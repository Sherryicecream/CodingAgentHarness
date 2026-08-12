# Final Delivery Hardening Design

## Goal

把 Coding Agent Harness 收尾为“本地可信产品 + 可下载 npm tarball Release”的真实交付版本，并让课程文档、机制实现、分发验证和 submission 模板一致。

## Decision

本次交付不继续公网托管，不删除 Node Server 或 public/demo 代码。正式用户路径是：从 Release 下载 npm tarball，在全新机器上用 npm 安装，CLI 在 `127.0.0.1` 启动本地 WebUI；用户可使用浏览器内存中的 BYOK，或使用主密码保护的本地服务器凭据。public 模式保留为确定性安全演示，但不宣称提供公网完整 coding agent。

`submission.jsonc` 的最终目标是 `is_deployed=false`，`deploy_release_url` 使用实际 Release URL。只有在 Release 已真实创建并可下载后才填写该 URL；外部发布、推送和 NJU Git 同步不属于本地实现阶段。

## Scope and boundaries

### In scope

1. 修复危险工具风险等级与 Governance/HITL 的连接，保证 `dangerous` 工具即使命令文本安全也需要人工审批。
2. 将 MemoryStore 作为显式依赖接入 AgentLoop，并按 `projectPath` 隔离检索与上下文注入。
3. 增加 mock-LLM 驱动的反馈因果测试：第一次动作造成确定性失败，反馈包含可执行修复信息，LLM 根据反馈选择不同的下一动作。
4. 修复 CLI、Server、Core 的 npm 包元数据和安装后入口；让 CLI 在脱离 monorepo 的全新临时目录中启动本地 Server/WebUI。
5. 生成并验证 npm tarball 分发产物；记录 tarball 内容、安装命令、启动命令、localhost WebUI 和虚假凭据生命周期验证。
6. 统一 README、SPEC、PLAN、SPEC_PROCESS、AGENT_LOG 中的本地交付策略、真实实现、CI 和历史偏离说明；REFLECTION 仅由学生本人按审核清单修订。
7. 为 CI 增加生产构建和 pack/入口验证，不把真实凭据写入测试、日志、Git 或产物。

### Out of scope

- npm registry 登录、OTP、组织 scope 申请和 `npm publish`，除非学生另行明确授权。
- 云服务器、域名、ngrok、HTTPS 隧道、后台服务和开机自启。
- 公开容器镜像发布。
- 代写或整篇重写 `REFLECTION.md`。
- 修改 `master`、覆盖用户未提交内容、强制推送或 NJU Git 同步。

## Architecture

### Runtime path

```text
npm tarball
  -> global/local npm install
  -> harness CLI
  -> resolve installed @harness/server entry
  -> localhost Express + built React client
  -> local runtime policy
  -> AgentLoop(LLM adapter, ToolRegistry, Governance, Feedback, MemoryStore)
```

The CLI must resolve the installed server package through a stable package entry, never through a monorepo-relative fallback. The server package must expose the runtime entry and include the built client assets required by `npm start`/`harness`.

### Governance boundary

Tool dispatch remains the final authority. Before execution, Governance evaluates both the action's command/path policy and the registered tool's declared risk. A dangerous tool enters the existing HITL state machine even when its arguments do not match a blocked-command regex. Safe tools continue through the existing deterministic policy checks.

### Memory boundary

AgentLoop receives a `MemoryStore` dependency and a project identity. Each iteration queries only memories for that project, applies the existing relevance ordering, and passes a bounded list to ContextBuilder. Memory writes preserve the same project identity. A direct cross-project search test must fail before implementation and pass after implementation.

### Feedback boundary

The deterministic scenario uses a mock adapter with an observable request history. The first response selects an action that yields a known failed test result. The feedback pipeline creates a structured failure plus actionable fix context. The next adapter response is selected by inspecting that feedback, not by an unconditional FIFO step. The test asserts both the feedback payload and the changed second action.

## Distribution contract

The deliverable is a versioned npm tarball attached to a GitHub/NJU Release. The README will state:

- how to obtain the tarball;
- the exact install and `harness` commands;
- Node.js/platform prerequisites;
- that the service binds to loopback by default;
- BYOK and master-password credential safety boundaries;
- that public/demo mode is deterministic and does not accept real keys;
- known limitations of local single-user operation.

The tarball must not contain `.env`, credential files, logs with secrets, `node_modules`, workspace-only relative paths, or unbuilt entrypoints.

## Verification gates

Every implementation task follows RED → GREEN → refactor and receives both spec-compliance and code-quality/security review. The final verification must include:

1. Core and Server tests, build, and package-specific tests.
2. Credential and placeholder scans over tracked files, history reachable from the delivery branch, and generated tarballs.
3. `npm pack --dry-run` plus actual tarball inspection.
4. Installation into a brand-new temporary directory with no repository workspace present.
5. CLI startup and HTTP access to `http://127.0.0.1:<port>`.
6. Fake-key lifecycle: initialize, status without plaintext, update, lock, unlock, clear.
7. A6 mechanism demonstration: dangerous-action interception, feedback-driven changed action, and the selected deep mechanism.
8. CI configuration validation for `unit-test`, production build, and pack checks.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Package scope or npm permissions are unavailable | Do not publish; use tarball Release and record the limitation honestly. |
| Server assets are omitted from tarball | Inspect `npm pack --json` and start from a clean directory before any release claim. |
| Local credentials leak during verification | Use only sentinel values, isolated temp directories, redacted output, and cleanup. |
| Public/local wording regresses | Treat README, SPEC, and submission fields as one reviewed contract. |
| Existing historical process deviations cannot be repaired | Preserve history and document the deviation; do not invent earlier evidence. |

## Acceptance criteria

- A fresh install from the tarball starts `harness` and serves the local WebUI without monorepo files.
- Dangerous tool risk is enforced by code and covered by a mock-driven test.
- Memory reads and writes are project-scoped and visible in AgentLoop context.
- Feedback causes a demonstrably different next action in a deterministic mock test.
- No README/SPEC text presents cloud deployment or public BYOK as the selected final delivery.
- `submission.jsonc` is changed only after a real Release URL exists and then uses `is_deployed=false`.
- Final test, build, scan, and cold-start evidence is recorded with commit hashes and manual decisions.
