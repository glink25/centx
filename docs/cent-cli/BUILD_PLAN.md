# Cent CLI 构建计划

> 面向 `npx cent-cli` 与 AI Agent（MCP / Skill）的非交互式命令行工具。

---

## 0. 设计原则

**CLI 是直观、无交互的"纯函数"工具**，类似 `ls` / `cat` / `gh`：

1. **零交互**：不弹 prompt、不弹 confirm、不弹 modal。所有输入来自 flag、参数、环境变量、stdin。
2. **直接输出**：默认人类可读纯文本；`--json` 切换到结构化 JSON（供 AI/脚本消费）。错误走 exit code + stderr。
3. **幂等可脚本化**：每条命令一次执行一次结果，可在 pipeline / cron / AI tool-call 中安全调用。
4. **无副作用 UI**：不引入 React、Radix、任何 DOM/Modal。Cent Web 中所有 `modal.prompt()` 这类调用，在 CLI 中**必须替换为参数化 API**——而不是替换成命令行 prompt。

这条原则是 CLI 与 Web 端最大的分歧点：Web 通过 modal 收集用户输入，**CLI 必须把这些输入提升为命令的 flag**。例如 Web 中"创建账本时弹 modal 让用户输入账本名"，CLI 中变成 `cent-cli book create --name foo`。

---

## 1. 复用与边界

Cent Web 的代码可分为三层，CLI 只复用前两层：

| 层 | 例子 | CLI 处理 |
|---|---|---|
| ① 纯逻辑 | `src/ledger/*`、`src/database/stash.ts`、`src/database/patch.ts`、`src/api/predict/*`、`src/api/storage/analysis.ts`、`src/tidal/*`、`src/utils/*`（非 DOM 部分） | **直接 import 复用** |
| ② 协议/网络 | `src/api/endpoints/{github,gitee,webdav,s3}/index.ts`（除登录交互外的方法） | **直接复用**，仅替换登录入口 |
| ③ UI / 交互 | `src/components/modal/*`、所有 `*.tsx`、登录的 OAuth 重定向跳转、`localStorage` 直读 | **不复用**，CLI 用 flag/配置文件替代 |

**关键约束**：业务逻辑层禁止 import UI 层。当前 `src/api/endpoints/*` 的工厂签名 `init({ modal })` 直接耦合了 modal——CLI 接入时需要先**重构 endpoint，把"需要用户输入"的能力从"运行时 modal 调用"改成"构造时注入参数"**。详见 §3。

---

## 2. 架构

```
cli/
├── bin/cent-cli.ts          # commander 入口，#!/usr/bin/env node
├── src/
│   ├── commands/            # 一命令一文件，每个导出 { meta, handler }
│   ├── runtime/
│   │   ├── config.ts        # ~/.cent-cli/config.json 读写（替代 localStorage）
│   │   ├── context.ts       # 解析 endpoint + 当前 book，构造 endpoint 实例
│   │   └── output.ts        # print(data, { format: 'text'|'json' })
│   ├── shims/
│   │   ├── localStorage.ts  # 文件型 localStorage（仅供 src/ 复用代码读取）
│   │   ├── indexedDB.ts     # fake-indexeddb 桥接（阶段 2 引入）
│   │   └── window.ts        # 最小 window/document 桩
│   └── core/                # alias 出口，re-export src/ 中的纯逻辑
├── package.json             # name: cent-cli, bin: { cent-cli: ./dist/bin/cent-cli.js }
└── tsup.config.ts
```

**打包**：`tsup`（esbuild），输出 ESM，Node ≥ 18（原生 fetch / Web Crypto）。

**模块替换**：tsup 的 esbuild alias 把 Cent Web 中的 `@/components/modal`、`@/components/modal/prompt` 等替换为**会抛错的桩**——确保任何走到 modal 的代码路径在 CLI 中都被静态消除或在重构后绕开。

---

## 3. Endpoint 重构（先决条件）

`SyncEndpointFactory.init({ modal })` 与 `login({ modal })` 是 CLI 化的最大障碍。需先在主仓库做小幅重构：

```ts
// 现状
type SyncEndpointFactory = {
  login: (ctx: { modal: Modal }) => void;
  init: (ctx: { modal: Modal }) => SyncEndpoint;
};

// 重构后
type SyncEndpointFactory<Cfg> = {
  // 纯参数化构造，CLI 直接调用
  create: (cfg: Cfg) => SyncEndpoint;

  // Web 专用：通过 modal 收集 cfg，调用 create
  loginWeb?: (ctx: { modal: Modal }) => Promise<Cfg>;
};
```

具体到各 endpoint：

| Endpoint | CLI 需要的 cfg | CLI 获取方式 |
|---|---|---|
| github | `{ token }` | `cent-cli login github --token $GITHUB_TOKEN` 或 env |
| gitee | `{ token }` | 同上 |
| webdav | `{ url, username, password }` | flag / env |
| s3 | `{ endpoint, region, bucket, accessKeyId, secretAccessKey }` | flag / env |
| offline | `{ dataDir }` | 默认 `~/.cent-cli/offline/` |

`cent-cli login <type>` 命令做的事：**校验凭据有效 → 写入 `~/.cent-cli/config.json`**，没有任何 prompt。Web 端 OAuth 重定向流程在 CLI 中**不实现**，CLI 只接受用户已经签好的 token——这是 `gh auth login --with-token` 的同款思路。

---

## 4. 阶段 1 — 最小化验证

**目标**：跑通 `login → books → search` 三条非交互命令。

### 范围
1. CLI 框架 + `~/.cent-cli/config.json` 配置层
2. 完成 §3 的 endpoint 重构（仅 GitHub）：抽出 `GithubEndpoint.create({ token })`
3. `localStorage` shim：把 Cent Web 中读 `localStorage.getItem("...")` 的调用重定向到配置文件
4. 命令：
   - `cent-cli login github --token <PAT>` — 校验后写配置
   - `cent-cli logout`
   - `cent-cli books` — 列账本（默认表格 / `--json`）
   - `cent-cli search --book <id> [-q <filter-query>]` — 列账单
5. **不接入** IndexedDB / tidal / 写操作

### 关键技术决策
- 阶段 1 直接 `endpoint.getAllItems(bookId)` 在线拉取，不做本地缓存——绕开 IndexedDB shim
- 输出格式：默认表格（`cli-table3`），`--json` 输出结构化数据
- 错误：非零 exit code + stderr 单行 JSON `{"error": "...", "code": "..."}`（`--json` 模式下）

### 验收
真实 GitHub Cent 账户上 `npx cent-cli login github --token $T && npx cent-cli books --json` 输出与 Web 端一致。

---

## 5. 阶段 2 — 写操作 & 增量同步

**目标**：CRUD 全套；CLI 与 Web 共享同一个 GitHub 仓库且数据一致。

### 范围
1. **IndexedDB shim**：`fake-indexeddb` + 文件持久化（落地 `~/.cent-cli/cache/<book-id>/`），让 `src/database/storage.ts` 在 Node 下工作
2. **接入 tidal 增量同步**：复用 `src/tidal/`，新增 `cent-cli sync [--book <id>]`
3. **写命令**（全部参数化、零交互）：
   - `cent-cli add --amount 100 --category food --comment "lunch" [--date 2026-05-09] [--tags a,b]`
   - `cent-cli update <bill-id> --amount 120`
   - `cent-cli delete <bill-id>`
4. **filter-query 接入**：`search -q "category:food amount>50"` 直接复用 `src/ledger/filter-query`
5. `cent-cli use <book-id>` 把当前账本写进配置（之后命令省略 `--book`）

### 风险
- IndexedDB 在 Node 下事务/并发与浏览器有差异，需要对 `database/stash.ts`、`database/patch.ts` 做端到端测试
- comlink Worker：阶段 2 暂时**直接 import worker 模块的导出函数同步执行**，不引入 `worker_threads`

### 验收
端到端：CLI add → CLI sync → Web 端打开能立即看到，反之亦然。

---

## 6. 阶段 3 — 多 Endpoint

**目标**：覆盖 gitee / webdav / s3 / offline。

### 范围
1. 完成 §3 中 4 个 endpoint 的 `create(cfg)` 重构
2. 命令：
   - `cent-cli login gitee --token <T>`
   - `cent-cli login webdav --url <U> --username <U> --password <P>`（密码也支持从 stdin 读取避免出现在 history）
   - `cent-cli login s3 --endpoint ... --region ... --bucket ... --access-key ... --secret-key ...`
   - `cent-cli login offline [--dir <path>]`
3. 多账户配置：`~/.cent-cli/config.json` 支持多 profile，`--profile <name>` / `CENT_PROFILE` 切换
4. 敏感字段处理：S3/WebDAV 凭据存储时考虑 `keytar`（系统 keychain）作为可选后端

**不实现** Web 端 OAuth 重定向流程。CLI 始终走"用户提供已签 token"的模式。

---

## 7. 阶段 4 — 分析 / 导入

> **不接入 predict 模块**：`src/api/predict/*` 依赖在线训练数据 + IndexedDB 持久化的特征向量，CLI 进程一次性的特性与之不匹配；分类决策放给上游 AI Agent（通过 MCP 直接生成 `category` 参数）更自然。CLI 严格要求 `--category`，不做任何隐式推断。

### 范围
1. **`cent-cli analyze -q <filter> [--by category|tag|month|year] [--format text|json|csv|md]`**（**4A 已完成**）
   - 复用 `src/api/storage/analysis.ts`
2. **`cent-cli import <file> [--strategy] [--as-mine|--no-as-mine] [--yes]`**（**4C 已完成 — 仅 plain JSON**）
   - Cent backup JSON：复用 Web `appendCategories` / `merge` 纯逻辑；默认 dry-run，加 `--yes` 才写入；stdin 支持 `cat backup.json | cent-cli import - --book ...`
   - **暂不支持** zip 备份（含附件路径）；CSV / 微信 / 支付宝 schema 化导入留待 4D，复用 Web 端的导入 schema：`cat bill.csv | cent-cli import - --scheme wechat`
3. **周期记账**：`cent-cli recurring list` / `cent-cli recurring run`（执行到期模板）
4. Worker 迁移到 `worker_threads`（性能优化，可选）

---

## 8. 阶段 5 — MCP / Skill（核心目标）

> **当前状态**：Skill 部分已落地（见 `memory.md` §9.8）；MCP 延后到有 Claude Desktop（无 shell）需求时再加。决策理由：cent-cli 已是 node CLI，Claude Code/Cursor 等带 Bash 的客户端只需 SKILL.md 引导 AI 通过 `npx -y cent-cli@latest <cmd>` 调用，零 MCP server 代码 + 零 schema 双轨维护。SKILL.md 的 frontmatter description / DSL 章节 / JSON schema 章节未来可直接迁到 MCP tool description。

**目标**：AI Agent 直接调用。这一步是整个项目的核心价值，前 4 个阶段都是它的铺垫。

### 范围
1. **MCP Server**：`cent-cli mcp` 启动 stdio MCP server
   - 工具集：`list_books` / `search_bills` / `add_bill` / `update_bill` / `delete_bill` / `analyze` / `sync`
   - 每个工具的 input schema 用 zod 定义，自动转 JSON Schema
   - 实现层**直接复用阶段 1-4 的 command handler**——MCP 只是协议适配
   - 工具描述要写得 AI 友好（明确参数语义、举例）
2. **Claude Skill 包**：
   - `cli/skill/cent/SKILL.md`：触发词、能力描述、调用示例
   - 工具背后调用本地 `cent-cli` 二进制
   - 可发布到 `~/.claude/skills/cent/`
3. **AI 友好性收尾**：
   - 所有命令必须支持 `--json`
   - 错误结构化：`{ error: { code, message, hint } }`
   - 命令的 `--help` 与 MCP 工具描述同源（避免漂移）

### 验收
在 Claude Code 中：
- "上个月吃饭花了多少？" → AI 调用 `analyze`
- "记一笔 50 块打车" → AI 自行决定 `category`，调 `add_bill`

---

## 9. 阶段 6 — 发布与持续维护

1. CI：主仓库 push tag 时自动 `pnpm --filter cent-cli build && pnpm publish`
2. 版本对齐：与 Cent Web 主版本同步（`1.5.x` ↔ Web `1.5.x`），CLI patch 独立
3. 兼容矩阵：Node 18 / 20 / 22，macOS / Linux / Windows
4. 文档：`docs/cent-cli/USAGE.md`、`MCP_GUIDE.md`、`CONTRIBUTING.md`

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Endpoint 重构改动主仓库 | 阶段 1 前置 | 重构保持向后兼容：旧 `init({modal})` 内部调用新 `create(cfg)` |
| `idb` / IndexedDB 在 Node 下行为差异 | 阶段 2 | `fake-indexeddb` 优先；不行则替换为基于 `level` 的轻量 KV |
| Cent Web 业务代码偷偷依赖 DOM / window | 全阶段 | 严格 alias + 跑通时检查 bundle 是否拉入 React |
| 数据格式漂移 | 全阶段 | CI 端到端：CLI 写 → Web 读一致性测试 |
| Token 明文落盘 | 阶段 3+ | 可选 keychain 后端（`keytar`） |

---

## 11. 第一步行动清单（阶段 1）

1. [ ] 主仓库小重构：`GithubEndpoint` 拆出 `create({ token })`，原 `init({ modal })` 内部调用之
2. [ ] 初始化 `cli/package.json`（`name: cent-cli`、`bin`、`type: module`）
3. [ ] 配 `tsup` + `tsconfig`，alias 把 `@/` 指向 `../src/`
4. [ ] 实现 `cli/src/runtime/config.ts` + `cli/src/shims/localStorage.ts`
5. [ ] 实现 `cli/src/runtime/output.ts`（text / json）
6. [ ] 实现 `cli/bin/cent-cli.ts` 路由 + `commands/login.ts`（仅 github + token）
7. [ ] 实现 `commands/books.ts`、`commands/search.ts`
8. [ ] 真实账户冒烟测试，对齐 Web 端输出

每个阶段产出独立可用的功能闭环；阶段 1 应在第一周内交付可演示版本。
