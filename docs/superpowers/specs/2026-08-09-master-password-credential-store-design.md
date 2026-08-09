# 主密码凭据存储设计

## 目标

将当前由“主机名 + 用户名”派生密钥的凭据文件替换为带主密码的加密文件，严格满足课程对安全凭据存储的要求。用户可以在本地可信模式中安全录入、查看状态、解锁、更新、锁定和清除 DeepSeek API Key；公网模式继续完全禁用凭据接口。

## 平台与范围

- 目标平台以 Windows 为主，但实现只使用 Node.js 标准库，因此也可在 macOS/Linux 运行。
- 不引入原生模块、系统钥匙串依赖、域名、HTTPS 或新的运行时依赖。
- “使用自己的 API Key”仍为单次请求内存态 BYOK，与本设计的持久化“本地服务器凭据”相互独立。
- 不把主密码或 API Key 写入浏览器存储、日志、URL、进程参数、Git 或明文配置文件。

## 存储格式

`~/.harness/credentials.enc` 改为版本化 JSON 加密信封：

```json
{
  "version": 2,
  "kdf": {
    "name": "scrypt",
    "salt": "<base64>",
    "N": 32768,
    "r": 8,
    "p": 1
  },
  "verifier": {
    "iv": "<base64>",
    "ciphertext": "<base64>",
    "tag": "<base64>"
  },
  "entries": {
    "harness/deepseek-api-key": {
      "iv": "<base64>",
      "ciphertext": "<base64>",
      "tag": "<base64>"
    }
  }
}
```

- `salt` 使用 16 字节安全随机数。
- 主密码通过 `scrypt` 派生 32 字节密钥，参数固定并写入信封以支持验证。
- 每个加密值使用 AES-256-GCM 和独立 12 字节随机 IV。
- `verifier` 加密固定内部标识，仅用于区分正确/错误主密码，不包含用户秘密。
- 文件以 `0600` 写入，目录以 `0700` 创建；使用同目录临时文件完整写入后原子替换。
- 派生密钥只保留在 Node 进程内存中；锁定时用 `Buffer.fill(0)` 清除引用内容。

## 状态模型

凭据存储暴露以下状态：

- `empty`：没有版本 2 凭据文件。
- `legacy`：检测到旧的无版本 base64 文件；不得再用主机名派生密钥自动解密。
- `locked`：版本 2 文件存在但当前进程没有派生密钥。
- `unlocked`：主密码验证成功，当前进程可读取服务器凭据。

服务重启后，版本 2 文件总是回到 `locked`。状态接口只返回状态和是否配置，不返回 Key、主密码、密文或 KDF 细节。

## CredentialStore 接口

保留现有同步调用方式，并增加显式锁定生命周期：

```ts
type CredentialStoreState = 'empty' | 'legacy' | 'locked' | 'unlocked';

interface CredentialStore {
  getState(): CredentialStoreState;
  unlock(masterPassword: string): boolean;
  lock(): void;
  initialize(masterPassword: string): void;
  hasKey(service: string): boolean;
  getKey(service: string): string | null;
  setKey(service: string, key: string): void;
  deleteKey(service: string): void;
  listServices(): string[];
}
```

- `initialize` 仅用于 `empty` 或用户明确迁移 `legacy` 状态，创建新信封并保持解锁。
- `unlock` 对错误密码返回 `false`，不抛出可区分密文细节的错误。
- `getKey` 在 `locked`/`legacy` 状态返回 `null`；环境变量来源仍可按既有优先级读取，但状态必须标记为 `env`，且绝不由接口回显明文。
- `setKey`/`deleteKey` 要求存储已解锁，否则抛出稳定的 `CREDENTIAL_STORE_LOCKED`。

## 本地配置 API

公网策略仍在路由装配层返回 `CONFIG_DISABLED`。

本地接口调整为：

- `GET /api/config/status`：返回 `{ hasKey, source, state }`。
- `POST /api/config/unlock`：接收 `{ masterPassword }`，成功返回 `200`，错误密码返回统一 `401 INVALID_MASTER_PASSWORD`。
- `POST /api/config/key`：
  - `empty`/`legacy`：接收 `{ key, masterPassword }`，验证主密码长度后初始化并保存；
  - `unlocked`：接收 `{ key }` 更新；
  - `locked`：返回 `423 CREDENTIAL_STORE_LOCKED`。
- `POST /api/config/lock`：清除内存派生密钥。
- `DELETE /api/config/key`：仅在解锁状态清除；清除最后一个条目后删除凭据文件并回到 `empty`。
- 删除 `GET /api/config/key-value`，不再把持久化服务器 Key 返回浏览器。
- `/api/agent/test-key` 和服务器凭据运行只在 `unlocked` 且 Key 存在时使用真实适配器。

## WebUI

配置页根据状态显示不同操作：

- `empty`：API Key 密码框 + 主密码密码框 + 保存按钮。
- `legacy`：说明旧格式不再受支持，要求重新输入 API Key 和新主密码完成迁移；不自动解密旧文件。
- `locked`：只显示主密码框和“解锁”按钮，同时允许用户看到“已配置但已锁定”状态。
- `unlocked`：允许测试连接、更新 Key、清除 Key和立即锁定。
- 主密码至少 12 个字符，最多 128 个字符；前后空格视为密码的一部分，不调用 `trim()`。
- API Key 输入仍为密码类型；主密码与 Key 在成功、失败、切换页面和组件卸载时清空。
- 移除 ChatPanel 从 `/api/config/key-value` 自动填充 BYOK 的逻辑。“本地服务器凭据”由服务端直接读取已解锁 Key，BYOK 始终由用户当次输入。

## 旧格式迁移

- 检测到旧 base64 文件时显示 `legacy`，不自动使用弱机器派生密钥解密。
- 用户重新输入 API Key 和主密码后，用版本 2 信封原子覆盖旧文件。
- 在此之前旧文件保持原状，避免未经用户确认的数据删除。
- README 说明升级后需重新录入一次服务器 Key。

## 错误与安全处理

- 文件损坏、未知版本或信封字段不合法时按 `legacy`/不可解锁处理，不回显解析或加密异常。
- 错误主密码、损坏认证标签统一返回 `INVALID_MASTER_PASSWORD`。
- KDF、解密、JSON 解析和文件系统错误不包含 Key、主密码或密文。
- 配置路由不记录请求体。
- Key 状态接口不返回 Key；持久化 Key 永不进入 React 状态。
- 进程退出无法保证 JavaScript 内存立即擦除，README 将其列为已知限制。

## 测试

- 凭据存储单元测试：信封格式、随机盐/IV、正确解锁、错误密码、锁定清零行为、原子写、0600、删除、损坏文件、旧格式迁移。
- 配置路由测试：状态、初始化、锁定、解锁、更新、清除、统一错误码、公网禁用、不存在 `key-value` 明文接口。
- Agent/测试 Key 回归：锁定时不能使用服务器凭据，解锁后可以；BYOK 不受影响。
- 前端测试：四种状态对应界面、密码不持久化、卸载清理、公开配置页不变、ChatPanel 不再读取持久化 Key。
- 全仓测试、server 构建、TypeScript 检查、差异检查和真实凭据扫描必须通过。

## 文档

- README 将“机器名 + 用户名派生”说明替换为主密码信封说明。
- 明确本地首次保存、重启后解锁、更新、锁定、清除和旧格式重新录入流程。
- SPEC 中的 Windows Credential Manager 描述改为“带主密码的 AES-256-GCM 加密文件”，并说明选择原因：零原生依赖、跨平台、可复现构建。
- 公开部署继续只提供 Mock 安全演示，不配置或保存任何 Key。

## 非目标

- 不实现 Windows Credential Manager、macOS Keychain 或 Linux Secret Service。
- 不自动迁移或恢复旧弱加密文件中的 Key。
- 不提供忘记主密码后的恢复能力；用户可清除并重新配置。
- 不允许公网匿名用户访问凭据接口。

## 验收标准

1. 没有主密码时无法解密版本 2 凭据文件。
2. 服务重启后持久化凭据为锁定状态，必须重新解锁。
3. 浏览器和 API 从不收到持久化 Key 明文。
4. 用户可在本地完成保存、解锁、更新、锁定和清除。
5. 公网安全演示和临时 BYOK 生命周期不退化。
6. README、SPEC 与代码采用同一凭据模型。
7. 相关测试、全仓测试和生产构建通过，无真实凭据进入差异。
