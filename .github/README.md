# CentX - 基于 Tauri 2.0 的 Cent 客户端

简体中文 | [English](./README_EN.md)

> You might only need an accounting software.

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-green.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri&logoColor=white)](https://tauri.app/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20iOS%20%7C%20Android-informational)]()
[![Release](https://img.shields.io/github/v/release/glink25/centx?include_prereleases&sort=semver)](https://github.com/glink25/centx/releases/latest)

**CentX** 是原 [Cent](https://github.com/glink25/Cent) 项目的 Tauri 客户端版本，将原本的 Web App 以**原生桌面端 / 移动端**形态重新交付。它继承了 Cent 的全部核心能力（GitHub 仓库作为数据库、增量同步、AI 助手、多币种、定时账单、地图可视化等），并在「离线可用性」、「网络自由度」和「Agent 可操作性」三个维度上进一步扩展。

🔗 **原 Web 版本**：<https://cent.linkai.work>
📦 **下载安装包**：<https://github.com/glink25/centx/releases/latest>
💾 **原项目仓库**：<https://github.com/glink25/Cent>
📖 **博客**：<https://glink25.github.io/tag/Cent/>

---

## 🧭 为什么需要 CentX

Cent 原本是一个「纯前端 PWA」应用，在浏览器中已经能覆盖绝大多数记账场景。但在长期使用中，有三类场景 Web 版本难以彻底解决；CentX 正是为这三类场景而生。

### 1. 🛰️ 对无网络环境更友好

PWA 理论上支持离线，但在实际使用中：

- 部分系统 / 浏览器（尤其是 iOS Safari 的某些版本、国内部分厂商定制浏览器）对 Service Worker 的离线策略并不完全支持，**飞行模式或弱网下启动 PWA 有概率失败**。
- Web 版本高度依赖首屏资源缓存，一旦缓存被清理或浏览器沙盒策略变化，就会陷入「无网络打不开应用」的尴尬境地。

CentX 使用 Tauri 将前端资源直接打包进安装包，应用启动完全不依赖网络或浏览器缓存：

- ✅ **真正的离线优先**：无网络环境下可以正常打开、记账、查询、统计，数据全部落盘本地。
- ✅ **网络恢复后自动同步**：重新联网后增量同步会自动续传，体验与 Web 版本保持一致。
- ✅ **面向飞机 / 地铁 / 出差场景**：不再担心「打开应用时发现加载不出来」。

### 2. 🌐 摆脱跨域限制

浏览器出于安全考虑会强制 CORS，Web 版 Cent 在对接第三方服务时存在两类硬性限制：

- **WebDAV / 自托管同步节点**：很多 NAS、私有云盘不会为你额外配置 CORS 头，浏览器直接拦截请求，需要架设代理才能使用。
- **AI 助手接口**：OpenAI-compatible 接口、私有大模型网关、企业内网 LLM 服务往往没有对浏览器开放跨域，导致只能通过中转服务调用。

CentX 在客户端内直接使用原生 HTTP 栈（`tauri-plugin-http`），**绕过浏览器同源策略**：

- ✅ **WebDAV 即插即用**：坚果云、群晖 WebDAV、自建 WebDAV 服务器等均可直接填写地址使用，无需代理。
- ✅ **AI 助手配置更简单**：任意 OpenAI 兼容端点（包括 Ollama、LM Studio、Azure OpenAI、企业自建网关）都能直连，不再需要搭建 CORS 代理。
- ✅ **API Key 不经过第三方**：所有请求都从你的设备直接发出，凭证不再被中间服务可见。

### 3. 🤖 桌面端支持 Skills 调用

这是 CentX 相对于 Web 版本最独特的能力。CentX 桌面端会在本地启动一个带 Token 鉴权的 HTTP 服务（详见「设置 → Agent API」），并以 Skill 的形式暴露给外部 Agent 工具。

这意味着你可以让 **Claude Code / Codex CLI / Cursor / Windsurf** 等 AI 编程助手直接操作你的账本：

- 📥 **让顶级大模型帮你批量导入**：把微信账单、支付宝账单、银行流水直接丢给 Claude / GPT-5 / Gemini，让它调用 CentX Skill 解析、归类并写入账本。
- 📊 **跨账本复杂分析**：用自然语言让 Agent 跨时间段、跨标签、跨分类做聚合分析，无需手写过滤器。
- 🔁 **自动化工作流**：把 CentX Skill 作为工具接入你现有的 Agent Pipeline，例如每月自动生成财务简报、对账提醒、预算告警。
- 🔐 **Token 式鉴权，权限可控**：Token 可随时在应用中重新生成，且只在本机生效；Agent 不接触你的 GitHub / WebDAV 凭证。

> Skill 是一个自包含的 Markdown 文档，包含工具列表与 JSON Schema，任何支持「注册外部工具」的 Agent 都能一键接入。

---

## ✨ 继承自 Cent 的核心功能

CentX 完整继承了 Cent Web 版的全部功能，以下为概览：

### 💾 数据完全自有
账本数据存储在你私有的 GitHub / Gitee 仓库或 Web DAV 中，不经过任何第三方服务器。支持通过 GitHub Collaborator **多人协作**，并使用**增量同步**机制仅上传/下载变化部分，显著降低同步时间。

### 🤖 AI 驱动体验
长按录音按钮即可**语音记账**，AI 自动解析金额、分类与备注。配置 OpenAI 兼容 API 后可实现账单智能分析、预算建议、年度总结以及基于历史数据的**智能预测**。

### 💱 多币种 & 定时账单
内置 30+ 国际币种 + 自定义币种，实时自动汇率换算，适合出国旅行与跨境交易。支持创建**定时账单**模板，用于订阅续费等固定支出。

### 📊 统计与可视化
多维度筛选与趋势分析、自定义分析视图、预算管理与进度监控，并支持在**地图上查看消费足迹**（高德地图）。

### 🛠️ 其它特性
- 📱 **多平台客户端**：macOS、Windows、Linux、Android 提供原生安装包；iOS 暂不发布 IPA，可自行编译或安装 App Store 上的 Swift 原生版本
- 📥 **智能导入**：微信 / 支付宝账单，可用 AI 自定义导入方案
- 🏷️ **分类与标签**：自定义分类、标签组、单/多选、偏好币种
- 📋 **快捷操作**：iOS 快捷指令、剪贴板记账、批量编辑、自然语言识别
- 🎨 **高度可定制**：深色模式、自定义 CSS、键盘自定义

*……还有更多功能等你发现 ✨*

---

## 🚀 安装与使用

### 方式一：下载预编译安装包（推荐）

前往 [Releases 页面](https://github.com/glink25/centx/releases/latest) 下载对应平台的安装包：

| 平台 | 文件格式 |
|------|----------|
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| macOS (Intel) | `.dmg` (x86_64) |
| Windows | `.msi` / `.exe` |
| Linux | `.AppImage` / `.deb` / `.rpm` |
| iOS | *暂不提供 Tauri 构建的 IPA* — 请 [自行编译](../src-tauri/docs/README_TAURI.md) 或从 App Store 下载 Swift 原生版本 |
| Android | `.apk` |

安装后，首次启动会引导你登录 GitHub / Gitee 或配置 WebDAV，随后即可开始记账。桌面版内置自动更新（`tauri-plugin-updater`）。

### 方式二：继续使用 Web 版

如果你不需要以上三点增强能力，原 Web 版仍在维护：<https://cent.linkai.work>

### 方式三：从源码构建

```bash
# 克隆项目
git clone https://github.com/glink25/centx.git
cd centx

# 安装依赖
pnpm install

# 桌面开发（当前系统）
pnpm tauri dev

# 发布构建（以 macOS Apple Silicon 为例）
pnpm build:macos
```

更多平台构建说明参见 [`src-tauri/docs/README_TAURI.md`](../src-tauri/docs/README_TAURI.md)、[Android 指南](../src-tauri/docs/ANDROID.md)、[Windows 签名](../docs/release/windows-signing.md)、[macOS 签名](../docs/release/macos-signing.md)。

---

## 🔌 启用 Agent Skill（桌面端专属）

1. 打开 CentX 桌面端，进入 **设置 → Agent API**。
2. 启用本地 API 服务，系统会生成一个本机 Token 与服务地址（默认 `http://127.0.0.1:<port>`）。
3. 点击「导出 Skill」，得到一份 `SKILL.md`。
4. 将其放入 Agent 工具能识别的目录：
   - **Cursor**：`.cursor/skills/cent-ledger-agent-api/SKILL.md`
   - **Claude Code / Codex CLI**：按工具约定的 skill / tools 目录放置
5. 在 Agent 中发起类似以下的自然语言指令：

   > 「帮我把这个月的支付宝账单分析一下，按分类汇总后写入 CentX」

Agent 会读取 Skill，通过本地 HTTP 接口调用 CentX 的工具完成操作。

> 📎 仓库内示例：[`.cursor/skills/cent-ledger-agent-api/SKILL.md`](../.cursor/skills/cent-ledger-agent-api/SKILL.md)

---

## 🔁 CentX 与 Cent 的关系

| 维度 | Cent (Web) | CentX (Tauri) |
|------|------------|---------------|
| 形态 | PWA Web App | 原生客户端（桌面 + 移动） |
| 离线可用性 | 依赖浏览器缓存 | 原生应用，完全离线 |
| WebDAV / AI | 受 CORS 限制 | 直连，无需代理 |
| Agent Skill | ❌ | ✅（桌面端） |
| 自动更新 | 浏览器刷新 | 内置 Updater |
| 账本数据 | GitHub / Gitee / WebDAV | GitHub / Gitee / WebDAV（完全兼容） |

**两端数据完全互通**：同一个 GitHub 仓库 / WebDAV 账户，Web 版与 CentX 可随时切换使用。

---

## 💬 反馈与贡献

欢迎提交 Issue 与 PR：

- 🐛 [Bug 反馈](https://github.com/glink25/centx/issues/new?template=bug_report.yml)
- 💡 [功能建议](https://github.com/glink25/centx/issues/new?template=feature_request.yml)
- 📖 [贡献指南](../docs/contributing/zh.md)
- 💬 QQ 群：`861180883`

---

## 📜 开源许可

本项目使用 **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)** 许可证：

- 允许分享、修改、再分发
- 需保留原作者署名
- **不得用于商业用途**
- 衍生作品须以相同许可证发布

---

## ☕️ 支持开发者

CentX 目前由一位开发者独立维护，如果它为你节省了时间，欢迎请作者喝杯咖啡。

<details>
<summary>展开查看赞赏方式</summary>

### 💰 支付宝

<img src="https://glink25.github.io/post-assets/sponsor-alipay.jpg" width="50%" alt="Alipay QR Code">

### 🌐 Solana (SOL)

**钱包地址：**

`vEzM9jmxChx2AoMMDpHARHZcUjmUCHdBShwF9eJYGEg`

<img src="https://glink25.github.io/post-assets/sponsor-solana.jpg" width="50%" alt="Solana QR Code">

</details>
