# Cent CLI — 新建账本（`book-create`）实施计划

> 目的：补齐 CLI 当前缺失的"创建账本"能力，让 `login → book-create → use → add → sync` 闭环不再依赖 Web 端。

---

## 1. 现状

- `cli/src/commands/book.ts` 仅有 `book-invite` / `book-delete`，均直接抛错"请用 Web 端"
- `books.ts` 只读取 `endpoint.fetchAllBooks()`，无写路径
- 底层 `SyncEndpoint.createBook(name: string) => Promise<{id, name}>` 在 `src/api/endpoints/type.ts:25` 已定义；github / gitee / webdav / s3 / offline 五种 endpoint 全部实现（映射到各 syncer 的 `createStore`），**不触发 modal、纯异步 API**
- 主仓库 `BUILD_PLAN.md` §3 提到的 endpoint 重构在 createBook 路径上同样不必要——与 CRUD 阶段一致，对 GitHub/Gitee/WebDAV 三个 CLI 已支持的 provider 直接复用即可

## 2. 设计

### 命令形态
```
cent-cli book-create <name> [--json]
```

- `<name>`：账本名，必填位置参数。沿用 Web 端规则——名称会被 endpoint 内部映射成 repo / 目录名（`repoPrefix + name`），CLI 不在前置做规则校验，把校验交给底层（如 GitHub `repos.createForAuthenticatedUser` 的命名约束）
- 不接收 `--description`、`--private` 等额外字段：`createBook(name)` 当前签名只吃 name；保持 CLI flag 与底层 API 等宽，避免凭空扩展
- 与现有命令同款 `--json` 全局选项

### 输出
- 文本：`created <name>  id=<owner/repo>` 单行
- JSON：`{ id, name }`（直接透传 `endpoint.createBook` 返回值）

### 错误
- 未登录 / endpoint 未配置：复用 `createActiveEndpoint()` 自带的报错
- 名称冲突 / 远端拒绝：`endpoint.createBook` 抛出原始错误，CLI 走 `printError` + exit 1（与其它命令一致）
- 不做"创建后自动 `use` 当前账本"：保持显式（与 git 一样，CLI 不替用户做隐式状态切换）。提示行可选输出：`(run: cent-cli use <id>)`

### 为什么不放进 `book` dispatcher
- 现有 `book-invite` / `book-delete` 是顶层命令名（带连字符），不是 `book <action>` 子命令风格
- 沿用相同形态新增 `book-create`，比把三者挪到 `book <action>` dispatcher 风险更低（后者会破坏既有调用面）
- 如果未来要统一成 `book <action>`，单独开任务，与本计划解耦

## 3. 实施步骤

1. **`cli/src/commands/book.ts`** 新增 `bookCreate({name, json})`：
   - `createActiveEndpoint()` 拿 endpoint
   - `await endpoint.createBook(name)` → 直接拿到 `{id, name}`
   - `printJson` / 文本输出；`process.exit(0)`（同 CRUD 写命令，杀掉 endpoint 内部 scheduler）
2. **`cli/bin/cent-cli.ts`** 注册 `book-create <name>` 命令并接 `--json`，调用 `bookCreate`
3. **`cli/src/commands/book.ts`** 头部注释微调：`book-invite` / `book-delete` 仍走"请用 Web 端"，但 `book-create` 是支持的——把"CLI does NOT mutate ..."那段注释收紧到 invite/delete
4. **冒烟脚本** `cli/scripts/smoke.sh`：
   - 末尾加一段：用 `CENT_TEST_PAT` 创建一个临时账本（名字带时间戳避免冲突）→ `books --json` 断言新账本可见 → 留下清理说明（CLI 不实现 `book-delete`，需要用户手动在 Web 端清理；smoke 中只提示）
   - 或者跳过此段（因为 GitHub 创建仓库副作用不可逆，smoke 不适合常态跑）——**建议加 `RUN_BOOK_CREATE_SMOKE=1` 环境变量门控**，避免每次冒烟都开新仓
5. **`docs/cent-cli/memory.md`**：在「已实现命令」表格中添加一行；「当前限制」中"book-invite / book-delete 任何 endpoint 下都报错"改为"create 支持，invite/delete 仍报错"

## 4. 风险与边界

| 风险 | 影响 | 对策 |
|---|---|---|
| GitHub repo 名规则（小写、连字符等）违反时报远端 4xx | 用户体验 | 透传原始错误信息，不在 CLI 侧前置校验（避免与底层规则漂移） |
| 创建副作用不可逆 | smoke / 误调用 | 不加 `--yes` 闸门（与 `add` 一致：单条创建是显式动作，不需要二段式）；smoke 用环境变量门控 |
| WebDAV / S3 创建语义是"建目录"而非"建仓库" | 概念差异 | 用户已知 endpoint 选择，CLI 透传，不做语义统一 |
| 创建后名称→id 解析（`<id>` 形如 `owner/cent-journal-foo`） | UX | 直接打印 endpoint 返回的 `id`，让用户后续 `--book <id>` 或 `--book <name>` 都能用（`resolveBook` 已支持两种） |

## 5. 验收

```bash
cent-cli login github --token $T
cent-cli book-create demo-book --json
# {"id":"<owner>/cent-journal-demo-book","name":"demo-book"}
cent-cli books --json | jq '.[].name'   # 包含 "demo-book"
cent-cli add --book demo-book --amount 1 --category 餐饮
cent-cli sync --book demo-book
```

跨 endpoint 验证（同步骤换 `login gitee` / `login webdav`）能复现，无 modal 触达、无主仓库改动。

## 6. 工作量估计

- 代码：约 30 行（command + 路由注册 + 注释更新）
- 测试：smoke 段约 15 行 + 环境变量门控
- 文档：memory.md 两处微调

整体 < 1 小时落地，无前置依赖。
