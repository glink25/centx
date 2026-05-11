# Cent CLI 进度备忘

> 记录截至当前已落地的实现、关键决策、和下一阶段执行建议。配合 `BUILD_PLAN.md` 阅读。

---

## 一、已实现（阶段 1 + 2A + 2B + 2C + 3 + 4A + 4B + 4C + 5-Skill 完成）

### 1. 项目脚手架（`cli/`）

- `cli/package.json`：独立 npm 包 `cent-cli`，`bin: cent-cli → dist/bin/cent-cli.js`，Node ≥ 18
- `cli/tsconfig.json`：复用根 `@/*` 别名指向 `../src/*`，新增 `@cli/*` 指向 `cli/src/*`
- `cli/tsup.config.ts`：esbuild 打包，ESM 输出，`#!/usr/bin/env node` banner
- 关键 alias（在打包时替换 Cent Web 的浏览器耦合模块）：
  - `@/components/modal` → `cli/src/modal/index.ts`（无交互桩）
  - `@/locale` → `cli/src/shims/locale.ts`（真实 i18n：跟随 `LANG` / `CENT_CLI_LANG` 选 zh/en，inline 两份 lang JSON）
- `define`：`import.meta.env.VITE_LOGIN_API_HOST` → `""`（CLI 不走 OAuth 重定向）

### 2. 浏览器 API shim（`cli/src/shims/globals.ts`）

入口 `bin/cent-cli.ts` **第一行** side-effect import 此模块，确保后续任何 `src/` 代码运行时全局已就绪：

| 全局 | 实现 |
|---|---|
| `localStorage` | 文件型，落 `~/.cent-cli/local-storage.json`（路径可被 `CENT_CLI_HOME` 覆盖，仅供测试隔离） |
| `uuid` 包 | tsup alias 到 `cli/src/shims/uuid.ts`，转发 `node:crypto.randomUUID()`；CLI 不依赖 `uuid` npm 包（避免误从 root workspace 拉取） |
| `@/locale` `t()` | `cli/src/shims/locale.ts`：启动时读 `process.env.CENT_CLI_LANG` 优先，否则按 `LANG/LC_ALL` 含 `zh` 字串归 zh，其余归 en；同步 import 两份 lang JSON；`t(key, _params?)` 仅查表，不渲染 ICU 占位符（CLI 当前路径没有参数化 key 需求） |
| ~~`indexedDB`~~ | **不再 shim**：account 主存储走 level（见 `@/database/storage` alias）；其它 `idb` 旁路（`utils/cache.ts` / `predict/*`）CLI 都不入。一旦未来误把 IDB 路径拉进 bundle，会立刻 `ReferenceError: indexedDB is not defined`，fail-loud 暴露问题（同 modal 桩思路） |
| `window` | 最小桩 `{ open, origin }` |
| `location` | 最小桩 `{ reload, origin }` |

### 3. Modal 桩（`cli/src/modal/index.ts`）

CLI 是非交互式的：`prompt` / `alert` / `confirm` / `show` 一律抛错，明确告知"该路径需要把交互参数提升为 flag"。`close` no-op，`loading` 直接返回 promise。

这意味着任何走到 modal 的代码路径在 CLI 中都会 fail-loud，迫使后续阶段把交互显式参数化（而不是悄悄静默）。

### 4. 配置与运行时

- `cli/src/runtime/config.ts`：薄包装 `localStorage`，提供 `setGithubToken / getGithubToken / clearAuth / getEndpointType`，沿用 Cent Web 的 storage key（`SYNC_ENDPOINT`、`github_user_token`），保证两侧配置兼容
- `cli/src/runtime/context.ts`：`createGithubEndpoint()` 动态 import `@/api/endpoints/github` 的 `GithubEndpoint`，注入 CLI modal，返回完整 endpoint 实例
- `cli/src/runtime/output.ts`：`printJson` / `printTable`（cli-table3）/ `printError`，文本 vs JSON 双格式
- `cli/src/runtime/book.ts`：`resolveBook(endpoint, input)` —— 含 `/` 按 id 解析，否则按 name 精确匹配 → CI 兜底；歧义时列出候选 id 报错

### 5. 已实现命令（仅 GitHub endpoint）

| 命令 | 说明 |
|---|---|
| `cent-cli login github --token <PAT>` | 调 `GET /user` 校验 token，写入 localStorage shim |
| `cent-cli logout` | 清空凭据 |
| `cent-cli books [--json]` | `endpoint.fetchAllBooks()` |
| `cent-cli search --book <name\|id> [-q <filter>] [--limit N] [--json]` | 解析 book → `initBook` → `toSync` → `getAllItems` → 可选 filter-query 过滤 |
| `cent-cli sync --book <name\|id> [--json]` | 仅刷新本地缓存，不打印明细；输出 `{ book, items, elapsedMs }` |
| `cent-cli add --book <b> --amount <n> --category <c> [--type expense\|income] [--comment <s>] [--time <iso>] [--tag <t>...]` | 写入本地 stash；**不自动同步**，须手动 `cent-cli sync` |
| `cent-cli update <bill-id> --book <b> [--amount/--type/--category/--comment/--time/--tag]` | 部分字段更新；未传字段保留原值 |
| `cent-cli delete <bill-id> --book <b> --yes` | 必须 `--yes` 才执行；写本地 stash |
| `cent-cli book-create <name>` | 调 `endpoint.createBook(name)` 在当前 endpoint 创建账本，返回 `{id,name}`；写后 `process.exit(0)` 同 CRUD 契约 |
| `cent-cli book-invite <owner/repo>` | 仅打印 `https://github.com/.../settings/access` 链接，CLI 不调 GitHub API |
| `cent-cli book-delete <owner/repo>` | 仅打印 `https://github.com/.../settings`（Danger Zone）链接 |
| `cent-cli stash --book <name\|id> [--show] [--json]` | **调试命令**：直接读 LevelDB 的 `__stashes` sublevel，输出未推 stash 数（含 `--show` 时打印每条）。传 `owner/repo` 完整 id 时**完全离线、零网络**——专用于验证"写未推"不变量 |

全局 `--json`：默认表格输出，`--json` 切结构化 JSON。错误走 stderr + exit 1。

### 6. 复用情况

**主仓库 `src/` 零改动**。CLI 直接 import 复用：

- `@/api/endpoints/github`（含 `LoginAPI`、modal 注入点）
- `@/tidal/*`（增量同步核心、`createTidal`、`createGithubSyncer`）
- `@/database/*`（`stash`、`scheduler`、`patch` 等；`storage` 在打包时被替换为 level 版）
- 通过 alias 在构建时静态替换浏览器交互模块，无需改源码

### 7. Level 持久化（阶段 2A 新增）

`@/database/storage` 在 tsup 中被 alias 到 `cli/src/shims/storage.ts`。该文件用 `level`（classic-level，自带 prebuilt 二进制，npx 友好）实现了与原 `BillIndexedDBStorage` 同形的类：

- 一个 `dbName` 一个 LevelDB，落 `~/.cent-cli/cache/<sanitized-dbName>/`（`/` 替换为 `__`）
- 四个 sublevel：`__stashes` / `__items` / `__meta` / `__config`，与原 IDB 的 object store 一一对应
- `toArray` 在内存中按 `timestamp`（stash）/ `time`（item）降序，模拟原 IDB cursor("prev") 行为
- `metaStorage` / `configStorage` 用单 key `metaKey` 存值；`get` 命中 `LEVEL_NOT_FOUND` 时返回 `undefined`
- `clearStorages` 关库后递归删除子目录；`dangerousClearAll` 关闭已开的所有库后清空 `cache/` 根

**关键收益**：tidal 的 `fetchStoreDetail` 会用 `configStorage` 里上次保存的 `StoreStructure` 与远端做 `diffStructure`，只下载变更的 chunk。持久化后第二次 `search`/`sync` 应只命中增量 IO，而非全量重拉。

**已知限制**：
- 同一进程内对同一 dbName 重复 `new BillIndexedDBStorage` 是允许的，但不同实例各自持有独立的 `dbPromise`，并发写入由 LevelDB 自身的单写者锁兜底（CLI 单进程场景下足够）
- 多 CLI 进程同时操作同一 book 会触发 LevelDB 锁错误——这是设计预期（IndexedDB 在浏览器多 tab 下也类似）

### 8. filter-query 接入（阶段 2B 新增）

`search` 现接受 `-q "<query>"`：

- 直接 import `@/ledger/filter-query` 的纯函数 `parseFilterQuery / compileFilterQuery / matchFilterQuery`
- ctx 来自 `endpoint.getMeta(book.id)`（`categories / tags / users / baseCurrency`），保证 `category:饮食` 这种按名字写的查询能解析为 id
- 查询字符串可加可不加 `q:` 前缀，filter-query 自动 strip
- 在 `getAllItems` 之后内存过滤——足以覆盖单本账本量级
- dayjs 插件 `isSameOrAfter` / `isSameOrBefore` 在 `cli/src/shims/globals.ts` 启动时 `dayjs.extend`（filter-query 自身不 extend，原 Web 端依赖 `src/ledger/utils.ts` 兜底；CLI 不入口该模块，需要自己 extend）
- 插件 import 必须带 `.js` 后缀（`dayjs/plugin/isSameOrAfter.js`），否则 ESM 产物运行时找不到

示例：

```bash
cent-cli search --book mybook -q "category:饮食 amount:>=50"
cent-cli search --book mybook -q "recent:7d type:expense" --json
cent-cli search --book mybook -q "tag:差旅 OR tag:打车"
```

### 9. CRUD（阶段 2C 新增）

**核心语义决策**：写命令只写本地 stash，不触发同步；同步只能通过显式 `cent-cli sync`。理由：CLI 是一次性进程，没有"后台 scheduler"的等价物；fork detached 子进程跑 sync 会与 LevelDB 单写者锁冲突，且错误隐身、跨平台不一致——综合判断不值得。最贴近 Web scheduler 的语义就是"前台等同步完"，但用户明确要求"对用户无感"，因此采用 git 风格的 commit/push 二段式：写=本地，sync=推送。

**主仓库零改动**：`inviteForBook` / `deleteBook`（GithubEndpoint init 中唯一会触发 modal 的两个方法）CLI 不接入，对应 `book-invite` / `book-delete` 命令仅打印 GitHub 设置 URL；CRUD 三件套走 `endpoint.batch(...)`，不经过任何 modal 路径。BUILD_PLAN §3 列出的"endpoint 重构先决条件"在 GitHub endpoint 这里实际上不必要，多 endpoint 阶段（gitee/webdav/s3）届时再视各自情况处理。

**实现要点**：

- `add` 用 `node:crypto.randomUUID()` 生成 bill id，避免引入 `uuid` 依赖
- `--amount` 输入为主单位（如 `12.50`），内部 `numberToAmount` 转 10000:1 整数
- `creatorId` 来自登录时缓存的 `cent_cli_user`（localStorage shim 落 `~/.cent-cli/local-storage.json`）；`login` 命令会调一次 `GET /user` 同时拿到 `id + login` 落盘
- `--category` / `--tag` 名称解析在 `cli/src/runtime/meta.ts`：合并 `book.meta.categories + BillCategories（默认表）` 后按 id → name 顺序匹配；同名歧义（同分类既有 expense 又有 income 同名时）报错并提示传 `--type` 或 id
- tag 不存在则报错（"please create it in web app first"）——CLI 故意不创建 tag，防止 AI 调用失误污染 meta
- `update` 先 `getAllItems` 找原 bill，未传的字段保留；`--tag` 一旦传入即整体替换 `tagIds`（不做合并）
- `delete` 必须 `--yes`，否则拒绝执行（保持非交互前提下防误删）
- 写命令在 `endpoint.batch` 完成后立即 `process.exit(0)`，故意杀掉 endpoint 内部 `scheduler.schedule()` 触发的"自动同步"——保证用户感知中只有 `cent-cli sync` 才会推送

**示例**：

```bash
cent-cli add --book mybook --amount 12.5 --category 餐饮 --comment "lunch"
cent-cli add --book mybook --amount 30 --category 交通 --tag 差旅,打车
cent-cli update <bill-id> --book mybook --amount 15
cent-cli delete <bill-id> --book mybook --yes
cent-cli sync --book mybook            # 显式推送
cent-cli book-invite owner/cent-journal-mybook  # 仅打印 URL
```

### 9.5. analyze（阶段 4A 新增）

`cent-cli analyze --book <b>` 输出 Web stat 页面除 map / top-words 之外所有模块的结构化数据 + 每段对应描述。

**核心复用**：

- `@/utils/charts.ts` 的 `processBillDataForCharts`（纯函数）：产出 total / expenseStructure / incomeStructure / subCategoryStructure / tagStructure / userStructure / overallTrend / highestExpenseBill / highestIncomeBill
- `@/api/storage/analysis.ts` 的 `analysis()`：current / projected / previous / lastYear 四组 detail（含 day/week/month/yearAvg），CLI 自行计算 growthVsPrevious / growthVsLastYear

**时间范围强制显式**（用户决定）：

- `--from <iso> --to <iso>`：自定义区间 → analysis() CASE A
- `--unit year|month|week|day [--ref <iso>]`：unit + 参考时间 → analysis() CASE B（dayjs(ref).startOf(unit) ~ +1 unit）
- 都不传或两者并存均报错。这与其它命令"零默认魔法"的风格一致

**复用细节**：

- `fetchBills(range)` 在 CLI 中实现为内存切片：先 `endpoint.getAllItems(book.id)` 一次拉全（已带 sync），可选 `-q` filter-query 过滤后，按 `b.time >= s && b.time < e` 切片；`processBillDataForCharts` 喂当前期内 bills，`analysis()` 的 fetchBills 则对 previous / lastYear 区间也走这同一条路径
- `processBillDataForCharts.getCategory` 注入：合并 `meta.categories + BillCategories`，分类名走 i18n 翻译（`customName=true` 不翻译，与 Web 一致）
- `processBillDataForCharts.getUserInfo` 注入：尝试 `endpoint.getCollaborators(book.id)`（失败容错为 `user-<id>`），避免 GitHub API 错误炸命令
- 金额：`processBillDataForCharts` 内部已经 `amountToNumber` 转主单位；`analysis()` 返回的是 10000:1 整数，CLI 出口处对所有 `total/dayAvg/weekAvg/monthAvg/yearAvg` 再调一次 `amountToNumber`

**描述渲染**：复用 i18n key（`analysis.summary.<type>.<unit>` / `analysis.comparison.full` / `period.<unit>` / `analysis.growth.{positive,negative}`），需要 locale shim 的 `t()` 支持 `{var}` 简单占位符替换。本轮在 `cli/src/shims/locale.ts` 中扩展了 `t()`：值为 string|number 时直接 toString() 替换，缺失值替换为空串，无副作用。`structure / total / topExpense / topIncome` 描述句子由 CLI 自拼，避免引入新 i18n key 改主仓库。

**输出**：

- `--json`：`{ range, total, structure: {expense,income,subCategory,tag,user}, trend, top: {expense,income}, analysis: {current,projected,previous,lastYear,growthVsPrevious,growthVsLastYear}, descriptions: {summary?,comparison?,total,structure,topExpense?,topIncome?} }`
- 文本：分段标题（`# total` / `# expense structure` / `# tags` / `# analysis` / `# extremes`）+ 简单缩进对齐 + 描述句子；不走 cli-table3（多模块异构，表格反而碎）

**示例**：

```bash
cent-cli analyze --book mybook --unit month --json
cent-cli analyze --book mybook --unit year --type income
cent-cli analyze --book mybook --from 2026-01-01 --to 2026-04-01 -q "category:餐饮"
cent-cli analyze --book mybook --unit week --top 5
```

**filter 共享**：搜索/分析共用一份 `applyFilter`，已抽到 `cli/src/runtime/filter.ts`，复用 search 阶段的 ctx 双展开技巧（默认分类/标签同时插 `name=key` + `name=t(key)`）

**bundle 影响**：`@/utils/charts.ts` 引入 `lodash-es` 的 `merge / sortBy` + `@/utils/color`；`@/api/storage/analysis.ts` 引入 dayjs 插件；为解决 `dayjs/plugin/X` 无扩展名 ESM 解析问题，tsup 配置改为 `noExternal: [/^dayjs(\/.*)?$/]` 内联 dayjs 全套。bundle 从 ~180KB → ~245KB，已确认 0 处 echarts / react 泄漏；smoke 阈值同步从 200KB → 300KB

### 9.6. meta CRUD（阶段 4B 新增）

5 类 meta 实体（**category / tag / tag-group / budget / filter-view**）全套 CRUD 命令落地。底层抽象成单一 `MetaCollectionDescriptor<T>` + 通用执行器，每个实体只声明 schema 与字段映射。

**通用抽象（`cli/src/runtime/meta-collection.ts`）**：

- `MetaCollectionDescriptor<T>` 描述：`{ name, scope: "global"|"personal", pluralPath, nameField?, defaults?, localizeName?, validate? }`
- 五件套：`loadList / resolveItemId / commonAdd / commonUpdate / commonDelete`，外加 `requireBook / requireYes` 入参兜底
- 写路径统一：`endpoint.batch(repo, [{ type: "meta", metaValue: newMeta }])`，与 Web 端 `useLedgerStore.updateGlobalMeta / updatePersonalMeta` 完全同路径
- `personal` scope 自动按 `getCurrentUser().id` 取 `meta.personal[uid][pluralPath]`，写入时不破坏其他用户的 personal 切片
- `resolveItemId` 三路匹配：id / `nameField` 原值 / `localizeName(it)`（仅 categories 用），与 `runtime/meta.ts` 同思路；本轮保留旧 `meta.ts`（`add/update` 仍依赖它），未来视情合并

**字段 → flag 映射**：

| 实体 | scope | flags |
|---|---|---|
| `category` | global / `categories` | `--name --type expense\|income --parent <name\|id> --icon --color` |
| `tag` | global / `tags` | `--name --prefer-currency` |
| `tag-group` | personal / `tagGroups` | `--name --color --single-select --required --tags <name\|id,...>` |
| `budget` | global / `budgets` | `--title --total --start --end --repeat-unit --repeat-value --joiners <ids> --category-budget food=200,traffic=100 --only-tags <name\|id,...> --exclude-tags <...>` |
| `filter-view` | global / `customFilters` | `--name --display-currency --modules <m,...>` + BillFilter 一对一 flag：`--comment --recent <Nd/Nw/Nm/Ny> --start --end --filter-type --creators --categories --min-amount --max-amount --assets --scheduled --tags --exclude-tags --base-currency --currencies` |

**金额单位**：`budget.totalBudget / categoriesBudget[].budget` 与 `BillFilter.minAmountNumber / maxAmountNumber` 都是 10000:1 整数（Web `b.totalBudget / 10000` 渲染、`numberToAmount(args.minAmount)` 写入证实），CLI 入口统一接主单位 `--total 1000`，内部 `numberToAmount`。

**category 语义（用户决定 user_only_simple）**：

- `add`/`update`/`delete` 只允许操作用户自定义分类（`customName=true`）；built-in 默认分类只能在 `list/get` 中读
- `add` 强制 `customName: true`，与 Web `useCategory.add` 行为一致
- `update` 路径如解析到默认分类的 id（仅出现在 BillCategories 表里、没在用户 list 里），抛错并提示先 `category add` 一个自定义分类
- `delete` 兜底：剩余分类必须 income/expense 各 ≥ 1（与 Web `validateCategories` 一致）；其它行为不复刻（不动 `customName` 自动切换、不实现 `reset`）

**写后 `process.exit(0)` 同 bill 写**：`endpoint.batch` 内部触发的隐式 sync 被强制中断，保证"显式 `cent-cli sync` 才推送"契约一致。

**命令路由（dispatcher）**：cac 6.x 对真正的多词命令名（如 `category list`）匹配有缺陷——只注册 `cli.command("category list", ...)` 时，`category list`（无后续位置/选项）不会触发 action（实测）。改用单个 dispatcher 命令：每个实体一条 `cli.command("<entity> <action> [id]", ...)`，所有 flag 注册在同一命令上，handler 内部按 `action ∈ {list,get,add,update,delete}` 路由。这样：

1. 用户体验仍是 `cent-cli category list / cent-cli category add --name foo`（与 user 选择的 subcommand 风格一致）
2. cac 的位置参数与选项注册都按单命令处理，无歧义
3. 未识别 action（如 `category bogus`）由 dispatcher 抛错；缺/多位置参数也一并校验

代价：所有 5 类 flag（含仅 add/update 用的）都注册在同一命令，cac 不会在 `--help` 中区分"哪些 flag 适用于哪个 action"——这点交给文档与 dispatcher 报错弥补，对脚本 / AI 调用无影响。

**filter-view 复杂 flag 处理**：`update` 的 BillFilter 重建必须读其它 meta（categories/tags），属异步路径；`commonUpdate` 的 mutator 是同步的——所以在调用 `commonUpdate` 之前先 `buildBillFilter(opts, endpoint, bookId, existing.filter)` 异步算好新 filter，再传入 mutator 以同步替换。这避免了"两次 batch"的额外网络往返。

**示例**：

```bash
cent-cli category list --book mybook --json
cent-cli category add --book mybook --name 旅行支出 --type expense
cent-cli tag add --book mybook --name 差旅
cent-cli tag-group add --book mybook --name 出行 --color "#ff8800" --tags 差旅,打车 --single-select
cent-cli budget add --book mybook --title 月度餐饮 --total 1000 \
    --start 2026-01-01 --repeat-unit month --repeat-value 1 \
    --category-budget 餐饮=600,零食=200
cent-cli filter-view add --book mybook --name 近30天支出 --recent 30d --filter-type expense
cent-cli sync --book mybook
```

### 9.7. import（阶段 4C 新增）

`cent-cli import <file> --book <b> [--strategy append|overlap] [--as-mine|--no-as-mine] [--yes]` 把 Cent 备份 JSON 导入到目标账本，**默认 dry-run 预览**，加 `--yes` 才真正写入。

**输入边界（用户决策）**：

- 仅接受**纯 JSON 备份**；`.zip` / `.cent.zip` 直接报错退出，提示"export the underlying JSON or use the web app"。CLI 不复用 Web `processImportFile` 的 unzip + asset 映射路径——`fflate` 与 `File`/`Blob` 资产解析既不在最小闭环内，对 AI 调用面也无收益
- items 中 `images` 字段（base64 / URL / `assets/` 路径）原样保留，不做特殊处理；与 Web plain-JSON 路径一致

**两段式 UX**（与 `delete --yes` 同形）：

- 不带 `--yes`：解析输入 → `endpoint.initBook + toSync + getAllItems` 拉远端 → 计算 `incomingCount / importCount / skippedCount / metaDiff` → 仅打印；零写入
- 带 `--yes`：上述算完后调 `endpoint.batch(bookId, [...updates, metaUpdate], strategy === "overlap")`，写完 `process.exit(0)` 杀同步（同 add/update/delete 契约）

**策略复刻 Web `preview-form.tsx` 纯逻辑**（不复用 `importFromPreviewResult`，它依赖 `useLedgerStore / useUserStore`，CLI 直接复刻其纯逻辑分支）：

- `append`：`incoming.filter(b => existing.every(e => e.id !== b.id && e.time !== b.time))`——任一已有账单按 id 或 time 命中即跳过；meta 走 `appendCategories`，与 `BillCategories` 等价时清空 `categories` 字段，`merge(currentMeta, incomingMeta)` 合并其余字段
- `overlap`：`available = incoming.items` 全集；meta 直接用 `incomingMeta`；`endpoint.batch` 第三参 `overlap=true`（清空本地 stash 后再写）

**as-mine 重写**：默认 `--as-mine`（对齐 Web `asMine: true`），把每条 incoming bill 的 `creatorId` 改成 `getCurrentUser().id`；`--no-as-mine` 保留原 creatorId（Web 端开关同语义，配套警告"unknown users may show up when analyze"）。当 `--as-mine` 但未登录时报错（与 `add` 同款提示）。

**预览输出**：

- 文本：`book / strategy / as-mine (creator=...) / incoming items / to import / to skip / meta: categories +N / tags +N / budgets +N`，最后一行 `(run again with --yes to commit)`
- JSON：`{ dryRun: true, book, strategy, asMine, creator, incomingCount, importCount, skippedCount, metaDiff }`；执行后是 `{ ok: true, book, strategy, asMine, imported, skipped, metaDiff }`

**stdin 支持**：`<file>` 传 `-` 时读 fd 0；与"npx + pipe"风格一致。

**示例**：

```bash
cent-cli import backup.json --book mybook                       # 预览
cent-cli import backup.json --book mybook --yes                 # append + as-mine（默认）
cent-cli import backup.json --book mybook --strategy overlap --yes
cent-cli import backup.json --book mybook --no-as-mine --json
cat backup.json | cent-cli import - --book mybook
```

### 9.7. 多 endpoint 接入（阶段 3 新增）

**范围**：在不动主仓库的前提下，让 CLI 同时支持 GitHub / Gitee / WebDAV 三种 endpoint。**离线模式按用户决策不接入**——CLI 一次性进程对它无意义，且离线下没有真正可同步的远端目标。

**login 拆包（一 provider 一文件）**：

```
cli/src/commands/login/
├── types.ts    # ProviderLogin<TOpts> = { type, registerFlags, parseOpts, run }
├── index.ts    # PROVIDERS 注册表（仅 4 行）
├── github.ts   # GET /user 校验 + setGithubToken + setCurrentUser
├── gitee.ts   # GET /api/v5/user?access_token= 校验 + setGiteeToken
└── webdav.ts  # checkWebDAVConfig() 校验 + setWebDAVConfig（Web 同 key）
```

入口 `bin/cent-cli.ts` 的 `login <provider>` 命令通过遍历 `PROVIDERS`：

```ts
const loginCmd = cli.command("login <provider>", `... (${PROVIDER_NAMES.join(" | ")})`);
for (const p of Object.values(PROVIDERS)) p.registerFlags(loginCmd);
loginCmd.action(async (provider, opts) => {
    const p = PROVIDERS[provider]; // 不存在则报错列出可选
    await p.run({ ...p.parseOpts(opts), json: opts.json === true });
});
```

新增 endpoint = drop 一个文件 + `index.ts` 加一行；**零改动** `bin/cent-cli.ts`。github / gitee 共享 `--token` flag（`gitee.registerFlags` 留空，靠 github 注册的 `--token`），webdav 注册自己的 `--url / --username / --password / --proxy / --custom-user`。

**`runtime/context.ts` 通用化**：原 `createGithubEndpoint()` 重命名为 `createActiveEndpoint()`（旧名保留 alias 以零改动迁移既有 commands），按 `getEndpointType()` 路由到三个 endpoint 工厂；CLI modal 桩通过 `as unknown as never` 注入到 `init()`，因为 SyncEndpointFactory 的 modal 类型完整覆盖 `webDavAuth / toast / s3Auth`，CLI 桩故意只实现 `prompt/alert/confirm/show/close/loading` 子集——任何意外触达扩展方法的代码路径会立即 fail-loud。

**凭据存储**（与 Cent Web 完全同 key，配置文件互通）：

| Endpoint | localStorage key | shape |
|---|---|---|
| github | `github_user_token` | `{accessToken}` |
| gitee | `gitee_user_token` | `{accessToken}`（与 Web `manuallySetToken` 同形）|
| webdav | `web-dav-config` | `WebDAVEdit = {remote, username, password, proxy?, customUserName?}` |

`SYNC_ENDPOINT` key 单选 `"github"|"gitee"|"webdav"`；`clearAuth()` 一次清掉所有三套 + currentUser。`getEndpointType()` 返回类型收窄为 `EndpointType | ""`。

**WebDAV 校验复用 `@/tidal/web-dav#checkWebDAVConfig`**：发一次 `PROPFIND /`，accept 200 与 404；401/网络错给出原始错误信息。webdav npm 包 Node 18+ native fetch 无障碍，已加入 `cli/package.json` deps（root 同版 5.8.0，pnpm 单实例 hoist）。

**Gitee v5 用户接口**：`https://gitee.com/api/v5/user?access_token=<T>`，返回与 GitHub 同形的 `{id, login}`，CLI currentUser 读取路径无差。

**`book-invite` / `book-delete` 统一报错**（用户决策）：原本 GitHub 路径只打印 `https://github.com/<book>/settings/access` URL；多 endpoint 后既不打印任何 URL 也不调底层 `inviteForBook / deleteBook`（gitee/webdav 那俩 modal 触发分支永远不会被执行），任何 provider 下统一报「请使用 Cent 网页端」。命令 description 同步改为 "(not supported in CLI; please use the Cent web app)"，cac 位置参数从必填 `<book-id>` 放宽为 `[book-id]`，避免「忘传 id」与「不支持」两个错误并列误导用户。

**示例**：

```bash
cent-cli login github --token ghp_xxx
cent-cli login gitee  --token gxxx
cent-cli login webdav --url https://dav.jianguoyun.com/dav/ \
    --username me@x.com --password "<APP_PWD>" \
    --custom-user mac
cent-cli books --json   # 与 endpoint 无关；用 SYNC_ENDPOINT 路由
```

### 9.8. Skill + 全命令详细文档（阶段 5-Skill 新增）

**用户决策**：本轮不做 MCP（"Skill 现在 + MCP 之后补"）。理由是 cent-cli 已经是 node CLI，Claude Code/Cursor 等有 Bash 的客户端只需 Skill 引导 AI 通过 `npx -y cent-cli@latest <cmd>` 调用即可，零 MCP server 代码 + 零 schema 双轨维护。MCP 仅在未来需要 Claude Desktop（无 shell）时再加，那时 SKILL.md 已是现成工具说明可直接转 MCP description。

**SSOT 文档体系（`cli/src/docs.ts` + `cli/skill/cent-cli/SKILL.md`）**：

- `docs.ts` 集中存所有 19 个命令的 `{ name, description, examples }`：description 是多行长文本（filter-query DSL 速查、import JSON schema、`--yes` 契约、显式 sync 契约等），examples 是可直接 copy-paste 的命令行示例
- `wireDocs(cli)`：遍历 `cli.commands`，按 `cmd.rawName` 匹配 docs，把长文本暂存到 `cmd.__longDescription`，把 examples 通过 `cmd.example()` 注入；同时调用 `cli.help(callback)` 注册一个 helpCallback，每次 `<cmd> --help` 渲染时把长文本拼成 `Description` section 插入到 sections 数组的 index 2（cac 默认 layout：`[name/version, Usage, Commands?, Options, Examples?]`，插 index 2 即 Usage 下方）
- 顶层 `cent-cli --help` 列表里仍显示 `bin/cent-cli.ts` 注册时给的短 description；只有进了 `<cmd> --help` 才看到长文本，避免顶层列表被淹
- `wireDocs` 内部调用 `cli.help(callback)` 后，`bin/cent-cli.ts` 必须**不能**再调 `cli.help()`——cac 的 `help(undefined)` 会把 helpCallback 清掉、再注册一次 `-h --help` 导致选项重复

**SKILL.md（`cli/skill/cent-cli/SKILL.md`）**：

- frontmatter `name + description`：description 写得详尽是关键，决定 Claude 在什么场景触发这个 skill。当前覆盖记账、查询、分析、预算、导入等关键词
- 正文按 "When to use / Invocation / Critical contracts / Command map / Filter-query DSL / Import JSON schema / Examples / Output conventions / Things this CLI does NOT do" 分节
- 关键约束（contracts）独立成章：写入需 `sync` 才推送、`--book` 必填、analyze 时间范围必填、destructive 需 `--yes`、category 仅可写 customName=true、tag 必须先存在、amount 单位约定
- filter-query DSL：字段表 + 操作符 + 配方，与 `src/ledger/filter-query/README.md` 对齐
- import JSON schema：完整 Bill / GlobalMeta / BillCategory / BillTag 字段表 + amount 10000:1 整数提醒（CLI flag 是主单位、JSON 字段是整数，这是唯一容易踩的不一致点）

**`install-skill` 命令（`cli/src/commands/install-skill.ts`）**：

- 把 SKILL.md 通过 esbuild text loader（`tsup.config.ts` 加 `opts.loader[".md"] = "text"`）内联到 bundle，`src/skill/content.ts` `import skillMarkdown from "../../skill/cent-cli/SKILL.md"` 拿到字符串
- 默认写到 `~/.claude/skills/cent-cli/SKILL.md`；`$CLAUDE_HOME` 设置时改写到 `$CLAUDE_HOME/skills/cent-cli/`；`--dir <path>` 显式覆盖
- 已存在 SKILL.md 默认拒写（视为用户手改），需 `--force` 覆盖；`--print` 把内容打到 stdout 不写盘
- 不提供 `uninstall`：避免 CLI 暴露 `rm -rf <dir>` 这类破坏操作
- `package.json` 的 `files` 加 `"skill"`，让 npm tarball 也带源 markdown 给非 npx 安装方式（`pnpm i -g cent-cli` 等）查阅

**示例**：

```bash
npx -y cent-cli@latest install-skill            # 默认装到 ~/.claude/skills/cent-cli/
npx -y cent-cli@latest install-skill --print    # 仅打印 SKILL.md
npx -y cent-cli@latest install-skill --force    # 覆盖已有
npx -y cent-cli@latest install-skill --dir /tmp/skills/cent-cli --json
```

**端到端 UX**（用户视角）：

1. 在没装过 cent-cli 的电脑上：`npx -y cent-cli@latest install-skill` —— npx 自动下载 cent-cli + 安装 SKILL.md
2. 用户先手动 `npx -y cent-cli@latest login github --token <T>`（Skill 文档明确说明 login 必须用户自己跑，CLI 不开浏览器）
3. 在 Claude Code 里直接说"记一笔 50 块的午饭"——Claude 读取 skill 后用 Bash 跑 `npx -y cent-cli@latest add --book ... --amount 50 --category 餐饮 ...` + `... sync --book ...`

### 10. 验证

- 本地 `cd cli && pnpm build` 通过（产物 `cli/dist/bin/cent-cli.js`）
- 阶段 1 已端到端验证（用户 PAT）：`login → books → search` 全链路 OK，输出与 Web 端一致
- 阶段 2A Level 缓存待真实账户验证：`sync` 跑两次，第二次应明显更快、`~/.cent-cli/cache/book-<owner>__<repo>/` 目录生成
- 阶段 2B filter-query 待真实账户验证：`search -q "category:..."` 输出与 Web 端搜索框相同语法相同结果
- 阶段 2C CRUD 待真实账户验证：`add` 后 `search` 看到新条目（命中本地 stash），`sync` 后 Web 端能看到
- 阶段 4A analyze 待真实账户验证：`--unit month --json` 输出包含 total / structure / analysis / descriptions.summary 顶层字段
- 阶段 4B meta CRUD 待真实账户验证：5 实体 add/list/update/delete 闭环，`tag-group` 验证 personal scope 写入到当前用户 slot
- 阶段 4C import 待真实账户验证：dry-run 预览正确报告 `incomingCount/importCount/skippedCount`、`.zip` 拒绝、`--yes` 路径写出 1 条 stash、sync 后 Web 端能看到
- 阶段 3 多 endpoint 待真实账户验证：`login gitee --token <T> && books --json` 与 `login webdav --url <U> --username <U> --password <P> [--proxy <P>] [--custom-user <N>] && books --json` 路径分别能落 `gitee_user_token` / `web-dav-config` 到 `local-storage.json` 并列出账本；`book-invite` / `book-delete` 任何 endpoint 下都报错
- 阶段 5-Skill 已离线验证：`install-skill --print` 输出 295 行 SKILL.md（含 frontmatter + DSL/schema 节）；`install-skill --dir <tmp> --json` 写入并返回 `{ok, path}`；二次执行未带 --force 报错拒写；`--force` 正确覆盖；19 个命令 `<cmd> --help` 渲染 Description/Examples 节；顶层 `--help` 列表不被长文本污染；bundle 增至 ~365KB（SKILL.md 内联约 +12KB）
- **冒烟脚本**：`cli/scripts/smoke.sh`（npm: `pnpm test:smoke`）端到端覆盖 1 + 2A + 2B + 2C + 4A + 4B + 4C，要求 `CENT_TEST_PAT` 与 `CENT_TEST_BOOK` 环境变量；用 `stash` 命令精确验证"写后未推"不变量、densStashes 折叠、sync 清空 stash；analyze 验证 `--unit month` JSON 形状 + `--from/--to + -q` 范围模式 + 缺时间范围必失败；4B 段每实体跑 add → list → delete 最小闭环，验证 `--yes` 强制、dispatcher 拒绝未知 action、`budget.totalBudget` 按 10000:1 归一、`filter-view.recent 30d` 解析为 `{value:30, unit:"day"}`；4C 段把当前账本导出再原样 import（append 模式 → `importCount==0` 因 id+time 全命中）+ `.zip` 拒绝 + 合成单条 bill `--yes` 写入；末尾兜底 bundle ≤ 400KB（4C 后实测 ~330KB；阈值从 300 → 400 调整以容纳 4B meta CRUD + 4C import 累计的 lodash-es 内联与 webdav/gitee endpoint 传递依赖）

---

## 二、关键决策

| 决策 | 理由 |
|---|---|
| Phase 1 不重构 `GithubEndpoint`，靠 alias + modal 桩 | 验证"src/ 直接复用"假设；事实证明 Phase 1 命令路径不触发 modal，无需重构 |
| 不实现 OAuth 重定向，只接受用户已签 token | 同 `gh auth login --with-token`；CLI 应是无交互、可脚本化的 |
| 不把凭据放进环境变量 | 用户偏好（避免历史泄漏、避免约定泛滥）；只用 flag |
| `--book` 接受短名 | 减小 AI 调用时输错全名的概率，并隐藏 GitHub 仓库实现细节 |
| modal 桩抛错而非静默 | 一旦后续命令意外触达交互路径，立刻暴露问题 |
| Phase 2A 选 `level`（方案 B）而非 fake-indexeddb 序列化 | 原生 KV、原生事务，与 `database/stash.ts` 的并发预期最贴近；prebuilt 二进制覆盖主流平台，不影响 npx 体验 |
| 移除 `fake-indexeddb` / `idb` 依赖，不 shim `indexedDB` | 排查后确认 bundle 中 0 处读取 IDB API（`utils/cache.ts` 仅被 UI 组件 import；predict 已不接入；`@/database/storage` 由 level shim 替换）。保留 fake-indexeddb 反而是死代码 + 启动开销，去掉后任何意外触达 IDB 的路径会 fail-loud |
| `uuid` 通过 alias 显式转发到 `node:crypto.randomUUID()`，不写 npm 依赖 | 阻止"从 root workspace 偷偷拿到 uuid 包"这种隐式耦合；CLI 是独立 npm 包，必须自己声明所有运行时依赖 |
| Phase 2C CRUD 写完不自动 sync，必须显式 `cent-cli sync` | CLI 一次性进程没有真正的后台 scheduler；fork detached 子进程会冲突 LevelDB 锁、错误隐身；用户偏好"对用户无感的同步" → 折衷为 git 风格 commit/push 分离 |
| `book-invite` / `book-delete` 只打印 URL | CLI 不应承担仓库管理职责（建仓需要授权流、删仓不可逆）；同时回避了 `inviteForBook` / `deleteBook` 里的 modal 调用，主仓库零改动 |
| 写命令完成后 `process.exit(0)` 强制退出 | `endpoint.batch` 内部会调 `scheduler.schedule()` 启动一次 sync；CLI 必须显式 kill 它，否则违反"sync 仅显式触发"语义 |
| Locale shim 真实化（跟随系统 LANG，inline zh+en JSON） | 默认分类 `name` 是 i18n key（`Food`），用户/AI 在 CLI 中天然想传 `--category 餐饮`；空桩状态下 resolveCategoryId 三路兜底失效。一次性接入 i18n 同时让后续 `analyze` 输出格式化、错误提示等都自然受益 |
| `resolveCategoryId` / `resolveTagId` 三路匹配（id / 原 name / `t(name)`） | 参考 filter-query 的 `resolveIds` 二路骨架并扩展。`customName === true` 的分类不走翻译（与 Web 端 i18n 模型一致） |
| `search -q` 的 ctx 把默认分类/标签**双展开**而不修改 filter-query | 原 filter-query `resolveIds` 只比对 id\|name 两路；CLI 不动主仓库代码，只在 ctx 内为每个默认条目塞两份（`name=key` + `name=t(key)`），让中英文 query 都命中。求值时 `compiled.ids` 数组中相同 id 重复无副作用 |
| analyze 强制显式时间范围（`--from/--to` 或 `--unit`）；不允许默认 | analysis() 的 previous / lastYear 必须有清晰的"周期"语义；CLI 默认魔法（如"当前月"）会让 AI 调用语义模糊。强制显式与"零交互、无歧义"原则一致 |
| analyze 跳过 top-words / map 模块 | jieba-wasm 与 CLI 一次性进程不匹配（用户确认）；map 是纯 UI 渲染，原本就没结构化数据，对应到 CLI 没有意义 |
| analyze 不使用 cli-table3，而是分段缩进文本 | 多模块异构（total / structure / analysis 字段各不同），强行表格化反而碎；text 模式定位是"给人快速看一眼 + 描述句"，AI 走 `--json` |
| Locale shim 的 `t()` 扩展简单 `{var}` 替换 | analyze 描述复用 `analysis.summary.<type>.<unit>` 等 i18n key，必须支持 `{dayAvg}` 这类占位符；不接 ICU 全套（plural/select 当前 CLI 路径用不上） |
| tsup `noExternal: [/^dayjs(\/.*)?$/]` 内联 dayjs 全家 | `src/api/storage/analysis.ts` 用 `import isSameOrAfter from "dayjs/plugin/isSameOrAfter"`（无扩展名），dayjs 的 package.json 没在 exports 暴露这些子路径，Node ESM 直接报 `ERR_MODULE_NOT_FOUND`。`alias` 对 external 包不生效，最稳妥的解是把 dayjs 整体内联进 bundle（多 +35KB） |
| Phase 4B meta CRUD 抽象成 `MetaCollectionDescriptor<T>` + 通用 add/update/delete | 5 类实体（categories/tags/budgets/customFilters/tagGroups）共享同一写路径（`endpoint.batch({type:"meta"})`）与同一 id-列表语义；按 Web `useCategory/useTag/useBudget/useCustomFilters` 比对，差异只在字段 schema。抽象后每实体文件只声明 descriptor + 字段 builder，~150 行内 |
| Phase 4B 用 dispatcher 而非真正多词命令注册 | cac 6.x 实测：仅注册 `cli.command("category list", ...)` 时，输入 `category list`（无后续位置/选项）不触发 action（行为不一致 bug）；改用 `cli.command("<entity> <action> [id]", ...)` 单命令 + 内部 switch 路由，UX 与"subcommand"风格一致，且选项注册无歧义 |
| Phase 4B category 写命令仅支持用户自定义分类 | 用户决策 `user_only_simple`：customName 自动切换 / 默认表 reset 这些 Web 行为对 CLI/AI 调用方没收益，简化语义降低误操作面；删除时仅做 income/expense 各 ≥ 1 兜底（与 Web `validateCategories` 一致） |
| Phase 4B 复杂结构（budget / filter-view）用 flag 拍平 + `name=value,...` 微 DSL | 用户决策 `flags_only`：避免引入 `--payload-json` 这种"二级语法层"，让 AI 调用面与 `cent-cli add` 风格统一；`category-budget food=200,traffic=100` 是唯一一处复合语法，足够表达 `categoriesBudget` 这种 `{id, budget}[]` 结构 |
| Phase 4B `filter-view update` 在 mutator 之外异步重建 BillFilter | `commonUpdate` 的 mutator 是同步的，但 BillFilter 的 categories/tags 字段需要异步加载其它 meta 来做 name→id 解析；先 `buildBillFilter(opts, endpoint, bookId, existing.filter)` 算好新 filter，再传入 mutator 做同步替换。比"两次 batch"省一次往返 |
| Phase 4C import 仅支持 plain JSON，拒绝 zip | 用户决策：CLI 不导入附件，zip 路径需要拉 `fflate` + `File`/`Blob` + asset path 重写，对最小闭环和 AI 调用面零收益；fail-loud 比悄悄丢资产更安全 |
| Phase 4C 默认 dry-run，必须 `--yes` 才写入 | 用户要求"导入命令应该提供预览"+ 复用 `delete --yes` 的 gate 范式，让 AI 调用方天然能"先看再写"；默认无副作用 |
| Phase 4C 不复用 Web `importFromPreviewResult`，复刻其纯逻辑 | Web 实现耦合 `useLedgerStore / useUserStore` 两个 zustand store；CLI 直接读 `endpoint.getMeta` + `getCurrentUser` shim，零 React 依赖。`appendCategories` / `merge` / `cloneDeep` / `isEqual` 仍直接复用 `src/ledger/utils.ts` + `lodash-es`，保证语义对齐 |
| Phase 4C `--as-mine` 默认 true | 对齐 Web 端 `asMine` 默认 true 与"导入到当前用户名下"用户预期；显式 `--no-as-mine` 时若 incoming 含未知 creatorId，由 Web 端的 analyze 容错（已存在）处理，无 CLI 侧额外校验 |
| Phase 3 login 拆成 `commands/login/<provider>.ts` + 注册表 | 用户要求"便于后续接入新登录方式"；新 endpoint = drop 一个文件 + 注册表加一行，零改动入口 router；`ProviderLogin<T>` 三件套 `registerFlags / parseOpts / run` 把"该 provider 的所有知识"封装在自己的文件里 |
| Phase 3 沿用单一 `login <provider>` dispatcher 而非真正子命令 | cac 多词命令的边界问题已在 4B 踩过；继续用单命令注册所有 provider 的 flag union，每个 provider 在自己的 `parseOpts` 中校验必填——`--help` 不区分但 AI/脚本调用面是一致的 |
| Phase 3 webdav 凭据仅 flag、不接 stdin / 环境变量 | 与 Phase 1 的"不把凭据放进环境变量"同源；密码 stdin 是给人手交互的便利，CLI/AI 调用面已经天然用 flag，避免规范扩散 |
| Phase 3 不接入 offline endpoint | 用户决策：CLI 一次性进程对"无远端的纯本地存储"无意义，`offline` endpoint 在 Web 端的核心价值是"无网络访问下的暂存"，CLI 反而靠 LevelDB 缓存已天然有"暂存"语义 |
| Phase 3 `book-invite` / `book-delete` 改为统一报错 | 用户决策：原 GitHub 路径打印 settings URL，多 endpoint 后 webdav 没有对应 URL 概念，统一报错 + 提示用 Web 端最干净；同时回避了 gitee/webdav `init` 中底层 modal 触发分支，主仓库零改动 |
| Phase 3 modal 桩通过 `as unknown as never` 注入 | SyncEndpointFactory 的 modal 类型完整覆盖 `webDavAuth/toast/s3Auth`；CLI 桩故意只实现子集——cast 是 load-bearing 的：保持 modal 桩最小化，任何意外触达扩展方法的代码路径会立刻 fail-loud（runtime throw），而不是被静默 no-op |
| Phase 3 `createGithubEndpoint` 保留为 alias | 既有 13 个 commands 都通过这个名字拿 endpoint；重命名等同 13 处机械改动，价值低且易冲突。新代码用 `createActiveEndpoint`，旧名作为薄 alias 永久保留 |
| Phase 5 只做 Skill，不做 MCP（MCP 之后补） | 用户决策：cent-cli 已是 node CLI，Claude Code/Cursor 等有 Bash 的客户端只需 SKILL.md 引导 AI 调 `npx -y cent-cli@latest <cmd>` 就够了；MCP 唯一不可替代的场景是 Claude Desktop（无 shell），目前优先级低。SKILL.md 写得详尽时，未来转 MCP tool description 直接复用 |
| 命令长文本通过 cac helpCallback 注入 Description section，而非塞进 cli.command 的 description | cac 默认 subcommand --help 不渲染 description；同时顶层 `cent-cli --help` 列表用同一个 description 字段渲染（行内显示），把长文本塞 description 会污染顶层列表。方案：长文本暂存 `cmd.__longDescription`，helpCallback 拿 `cli.matchedCommand` 找它，splice 到 sections index 2 位置 |
| `wireDocs` 内部调用 `cli.help(callback)` 后必须移除 bin 里的 `cli.help()` | cac 的 `help(undefined)` 把 helpCallback 清掉、再注册 `-h --help` → 选项重复 + 长文本失效。这是 load-bearing 顺序约束 |
| SKILL.md 通过 esbuild text loader 内联到 bundle | install-skill 必须能从 fresh `npx` 拷贝单文件出来；外部 readFile + path resolve 在 npx 临时目录下脆弱。tsup `opts.loader[".md"] = "text"` + `import skillMarkdown from "../../skill/cent-cli/SKILL.md"` 把 markdown 内容编译进 JS 字符串，运行时只走 fs.writeFileSync，零路径假设 |
| `install-skill` 默认拒写已有 SKILL.md，需 --force | 视已有文件为用户手改内容；自动覆盖会无声丢失定制。与 `delete --yes` / `import --yes` 同源的"破坏性显式确认"模式 |
| 不提供 `uninstall-skill` 命令 | 等价于 `rm -rf <dir>`，CLI 暴露这种动作风险大于收益；用户自己 `rm` 一行更直接、blast radius 可控 |

---

## 三、当前限制（已知）

1. **支持 github / gitee / webdav，不支持 s3 / offline**：s3 endpoint 后续可按同模板新增 `commands/login/s3.ts`；offline 不接入（用户决策，CLI 一次性进程对它无意义）
2. **import 仅 plain JSON、无 zip / 附件**：用户决策，阶段 4C 落地的 `cent-cli import` 拒绝 zip。CSV / 微信 / 支付宝 schema 与 recurring（周期记账）仍未实现（**predict 已从计划中移除**，分类决策交给上游 AI 直接生成 `--category`）
3. **add 不支持 currency / images / location**：首期最小字段集；如需多币种或附件需 Web 端补
4. **add 不会自动创建 tag**：tag 必须先在 Web 创建，CLI 拒绝创建以防 AI 误污染 meta
5. **多 CLI 进程并发同一 book 会冲突**：LevelDB 单写者锁；目前只在文档中说明，未做友好降级
6. **filter-query 中 `user:<name>`** 暂只能按字面 id 匹配——`endpoint.getCollaborators` 调用成本高，未默认注入到 ctx.users
7. **`book-create` 已支持（任意 endpoint）；`book-invite` / `book-delete` 任何 endpoint 下仍报错**：创建走纯 `endpoint.createBook(name)`，无 modal；invite 是授权流、delete 不可逆，留给 Web 端
8. **Locale 仅支持 zh / en，不渲染 ICU 占位符**：`t(key, params)` 中 `params` 被忽略，仅做查表回退；当前 CLI 命令路径无 `t("hello {name}")` 这类用法，按需再扩

---

## 四、下一阶段执行建议

阶段 4A analyze + 4B meta CRUD + 4C import 已落地。账本数据面、meta 面、整本备份/迁移面都通了，剩下两条路：

### 选项 A：阶段 5 — MCP / Skill（推荐）

books / search / sync / add / update / delete / analyze / import + 5 类 meta CRUD 已闭环。MCP 工具描述要把：
- analyze 的 `--unit / --from / --to / --type` 语义说清楚，避免 AI 瞎传范围
- meta 写命令的"自动 stash + 显式 sync"契约让 AI 知道：连续多次 `category add / tag add` 之后必须显式 `sync`
- `category` 写仅限 customName=true，避免 AI 误碰内置默认分类
- `import` 默认 dry-run，AI 应先读 preview JSON 再决定是否传 `--yes`；`overlap` 会清空账本，必须谨慎

### 选项 B：阶段 4D — CSV / 微信 / 支付宝 schema 化导入

当前 4C 仅支持 Cent 自己的 JSON 备份格式。后续若要补"从微信 / 支付宝原生 CSV 导入"，复用 Web 的 `src/components/data-manager/schemas/*.js`，新增 `--scheme wechat|alipay` flag 与 stdin 支持。

**建议优先 A（MCP）**：六大业务面 + 三 endpoint 已齐，MCP 收益最大；s3 endpoint 与原生 CSV schema 都可在 MCP 之后增量补。

---

## 五、文件索引（cli/）

```
cli/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── bin/
│   └── cent-cli.ts                # 入口、命令路由（cac）
└── src/
    ├── shims/
    │   ├── globals.ts             # localStorage / indexedDB / window 注入；dayjs 插件 extend
    │   ├── locale.ts              # @/locale 桩
    │   ├── storage.ts             # @/database/storage → level-backed BillIndexedDBStorage
    │   └── uuid.ts                # uuid → node:crypto.randomUUID()
    ├── modal/
    │   └── index.ts               # @/components/modal 桩
    ├── runtime/
    │   ├── config.ts              # localStorage 读写包装
    │   ├── context.ts             # createGithubEndpoint()
    │   ├── output.ts              # text/json 输出
    │   └── book.ts                # resolveBook(name|id)
    └── commands/
        ├── login.ts
        ├── logout.ts
        ├── books.ts
        ├── search.ts
        └── sync.ts                 # 阶段 2A 新增
```

阶段 2A 新增文件：
- `cli/src/shims/storage.ts` — level-backed `BillIndexedDBStorage`（被 tsup alias 替换 `@/database/storage`）
- `cli/src/commands/sync.ts` — 显式同步并报告条目数 / 耗时

阶段 2B 改动：
- `cli/src/shims/globals.ts` — `dayjs.extend(isSameOrAfter|isSameOrBefore)`
- `cli/src/commands/search.ts` — 新增 `query?: string`，编译并应用 filter-query
- `cli/bin/cent-cli.ts` — `search` 注册 `-q, --query`

阶段 2C 新增：
- `cli/src/commands/add.ts` / `update.ts` / `delete.ts` —— CRUD（写本地 stash，不自动 sync）
- `cli/src/commands/book.ts` —— `book-invite` / `book-delete`（仅打印 GitHub URL）
- `cli/src/commands/stash.ts` —— 调试命令，直接读 LevelDB `__stashes` sublevel
- `cli/src/runtime/meta.ts` —— `resolveCategoryId` / `resolveTagId` 名称→id
- `cli/src/runtime/config.ts` —— 新增 `setCurrentUser` / `getCurrentUser`（缓存 `cent_cli_user`）
- `cli/src/commands/login.ts` —— 顺带把 `/user` 返回的 `id+login` 落盘
- `cli/scripts/smoke.sh` —— 端到端冒烟脚本（`pnpm test:smoke`）

阶段 4A 改动：
- `cli/src/commands/analyze.ts` —— analyze 命令，复用 `processBillDataForCharts` + `analysis()`
- `cli/src/runtime/filter.ts` —— 把 search.ts 里的 applyFilter 抽出，analyze 与 search 共用
- `cli/src/commands/search.ts` —— 改为 import 公共 applyFilter
- `cli/src/shims/locale.ts` —— `t(key, params)` 支持 `{var}` 简单占位符替换；同时新增 `intl: { locale }` export 兼容 `@/utils/time.ts` 的 `intl.locale === "zh"` 分支
- `cli/tsup.config.ts` —— `noExternal: [/^dayjs(\/.*)?$/]` 内联 dayjs 解决插件无扩展名 ESM 解析
- `cli/bin/cent-cli.ts` —— 注册 analyze 命令
- `cli/scripts/smoke.sh` —— analyze 三段冒烟（unit 模式 / range+filter 模式 / 缺时间范围必失败），bundle 阈值 200 → 300KB

阶段 4B 新增：
- `cli/src/runtime/meta-collection.ts` —— `MetaCollectionDescriptor<T>` + `loadList / resolveItemId / commonAdd / commonUpdate / commonDelete / requireBook / requireYes`，所有 meta CRUD 共用
- `cli/src/commands/category.ts` —— 用户自定义分类 CRUD（customName 强制 true、删除做 income/expense 兜底）
- `cli/src/commands/tag.ts` —— tag CRUD（最简）
- `cli/src/commands/tag-group.ts` —— personal scope tag-group CRUD（依赖 currentUser）
- `cli/src/commands/budget.ts` —— budget CRUD（含 `--category-budget k=v,k=v` 微 DSL，金额走 `numberToAmount`）
- `cli/src/commands/filter-view.ts` —— customFilters CRUD（BillFilter 各字段一对一 flag，`--recent 7d/3w/12m/1y` shorthand）
- `cli/bin/cent-cli.ts` —— 5 个 dispatcher 命令（每实体 `<action> [id]`），内部 switch 路由到 list/get/add/update/delete
- `cli/scripts/smoke.sh` —— Phase 4B 段：5 实体 add → list → delete 闭环 + `--yes` 强制 + 未知 action 拒绝 + sync 收尾

阶段 4C 新增：
- `cli/src/commands/import.ts` —— import 命令；plain JSON 解析 + `endpoint.batch` 写入；复用 `appendCategories` / `lodash-es.merge,cloneDeep,isEqual` 复刻 Web `preview-form.tsx` 纯逻辑
- `cli/bin/cent-cli.ts` —— 注册 `import <file>` + `--strategy / --as-mine / --no-as-mine / --yes` flag
- `cli/scripts/smoke.sh` —— Phase 4C 段：自身 backup 双向 round-trip dry-run（id+time 命中验证 append 跳过）+ `.zip` 拒绝 + 合成单条 bill `--yes` 写入 + sync 收尾

阶段 3 新增 / 改动（多 endpoint）：
- `cli/src/commands/login/{types,index,github,gitee,webdav}.ts` —— 一 provider 一文件 + 注册表；`ProviderLogin<T>` 接口三件套 `registerFlags / parseOpts / run`
- `cli/src/commands/login.ts` —— **删除**（拆分到 `login/` 子目录）
- `cli/src/runtime/config.ts` —— 新增 `setGiteeToken/getGiteeToken` + `setWebDAVConfig/getWebDAVConfig`；`clearAuth()` 清三套 + currentUser；`getEndpointType()` 收窄返回类型 `EndpointType | ""`
- `cli/src/runtime/context.ts` —— `createActiveEndpoint()` 按 `SYNC_ENDPOINT` 路由 github/gitee/webdav；旧 `createGithubEndpoint` 保留 alias（13 处 commands 零改动）；modal 桩 `as unknown as never` 注入
- `cli/src/commands/book.ts` —— `bookInvite/bookDelete` 改为统一 throw（无论 endpoint 都报错，提示用 Web 端）
- `cli/bin/cent-cli.ts` —— `login <provider>` 通过遍历 `PROVIDERS` 注册所有 flag + 分发；`book-invite/book-delete` 位置参数从 `<book-id>` 放宽为 `[book-id]`
- `cli/package.json` —— 新增 `webdav: ^5.8.0` 显式 dep
- `cli/scripts/smoke.sh` —— "0 — login dispatcher arg validation" 段：9 条离线参数校验（缺 provider / 未知 provider / 三 provider 各自缺必填 flag / book-invite/book-delete 总是报错）

构建：`cd cli && pnpm install && pnpm build`，产物 `cli/dist/bin/cent-cli.js`。
