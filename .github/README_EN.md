# CentX - Tauri 2.0 Client for Cent

[简体中文](./README.md) | English

> You might only need an accounting software.

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-green.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri&logoColor=white)](https://tauri.app/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20iOS%20%7C%20Android-informational)]()
[![Release](https://img.shields.io/github/v/release/glink25/centx?include_prereleases&sort=semver)](https://github.com/glink25/centx/releases/latest)

**CentX** is the Tauri-based client edition of the original [Cent](https://github.com/glink25/Cent) project, repackaging the web app as a **native desktop / mobile application**. It inherits every core capability of Cent (GitHub-repo-as-database, incremental sync, AI assistant, multi-currency, scheduled bills, map visualization, …) while going further along three axes where a pure PWA falls short: **offline reliability**, **network freedom**, and **agent operability**.

🔗 **Original Web Version**: <https://cent.linkai.work>
📦 **Download Installers**: <https://github.com/glink25/centx/releases/latest>
💾 **Original Repository**: <https://github.com/glink25/Cent>
📖 **Blog**: <https://glink25.github.io/tag/Cent/>

---

## 🧭 Why CentX

Cent is a "pure-frontend" PWA and already covers most accounting scenarios in the browser. However, three recurring pain points are hard to solve with a pure web app — these are exactly what CentX is built for.

### 1. 🛰️ Truly Offline-Friendly

PWAs support offline usage in theory, but in practice:

- Some platforms / browsers (notably certain iOS Safari versions and vendor-customized browsers on Android) do **not fully honor Service Worker offline strategies**, and **launching a PWA in airplane mode or on flaky networks can silently fail**.
- Web Cent depends heavily on cached shell assets. Once a browser evicts the cache or tightens its sandbox policy, the app becomes unreachable without network.

CentX bundles the frontend directly into the installer via Tauri, so the app no longer relies on the network or browser caches to boot:

- ✅ **Offline-first for real**: open, record, query and analyze transactions with zero connectivity. All data is persisted locally.
- ✅ **Seamless re-sync**: once back online, incremental sync resumes automatically — identical semantics to the web version.
- ✅ **Built for planes / subways / field trips**: no more "the app just won't open".

### 2. 🌐 Free From CORS Restrictions

Browsers enforce CORS for good reason, but it creates two hard limits for web Cent:

- **WebDAV / self-hosted sync endpoints**: many NAS boxes and private clouds don't ship CORS headers, so browsers block the requests outright — forcing users to spin up proxies just to connect.
- **AI assistant endpoints**: OpenAI-compatible gateways, private LLM inference servers, or enterprise internal models rarely expose CORS to browsers, so the web app can only reach them through a relay.

CentX uses the native HTTP stack (`tauri-plugin-http`) inside the client, **bypassing the browser's same-origin policy**:

- ✅ **WebDAV works out of the box**: Jianguoyun (Nutstore), Synology WebDAV, self-hosted WebDAV — just paste the URL, no proxy required.
- ✅ **Frictionless AI setup**: connect directly to any OpenAI-compatible endpoint (Ollama, LM Studio, Azure OpenAI, enterprise gateways, …) without hosting a CORS relay.
- ✅ **Credentials stay on your device**: every request originates from your machine; API keys never pass through an intermediate service.

### 3. 🤖 Agent Skills on Desktop

This is CentX's most unique capability over the web edition. The desktop build spins up a **token-authenticated local HTTP service** (see **Settings → Agent API**) and exposes it to external agent tooling as a self-contained **Skill**.

That means **Claude Code / Codex CLI / Cursor / Windsurf** — and any other tool-using agent — can drive your ledger directly:

- 📥 **Let top-tier LLMs import for you**: drop WeChat / Alipay / bank statements into Claude, GPT-5 or Gemini, and let the agent parse, categorize, and write entries back into CentX via the Skill.
- 📊 **Ad-hoc cross-ledger analytics**: ask in natural language to aggregate by tag, category, or time window — no hand-crafted filters.
- 🔁 **Automate your workflows**: plug CentX's Skill into your existing agent pipelines for monthly reports, reconciliation alerts, or budget reminders.
- 🔐 **Token-based, scoped authentication**: regenerate the token anytime from within the app; it is only valid on your machine and never exposes your GitHub / WebDAV credentials to the agent.

> A Skill is a self-contained Markdown document that lists every tool and its JSON Schema, so any agent that supports "register external tools" can plug in with one click.

---

## ✨ Features Inherited From Cent

CentX ships every feature of web Cent. Highlights:

### 💾 Fully Self-Contained Data
Ledger data lives in your own GitHub / Gitee repository or WebDAV — never on a third-party server. **Multi-user collaboration** is supported via GitHub Collaborators, and an **incremental sync** mechanism only transfers changed data, dramatically cutting sync time.

### 🤖 AI-Powered Experience
Long-press the record button for **voice bookkeeping** — the AI parses amount, category, and notes. Configure any OpenAI-compatible API for smart bill analysis, budget suggestions, annual summaries, and **predictions** based on your history.

### 💱 Multi-Currency & Scheduled Bills
30+ built-in currencies plus custom ones, with live exchange-rate conversion — ideal for travel and cross-border payments. Create **scheduled bill** templates for subscriptions and recurring fees.

### 📊 Statistics & Visualization
Multi-dimensional filtering, trend analysis, customizable analytic views, budget tracking, and **map-based spending footprints** (via AMap).

### 🛠️ And More
- 📱 **Multi-platform client**: native installers for macOS, Windows, Linux, and Android; iOS Tauri IPA is not yet released — build from source or install the Swift-native edition from the App Store
- 📥 **Smart import**: WeChat / Alipay bills, with AI-assisted custom import schemes
- 🏷️ **Categories & tags**: custom categories, tag groups, single/multi select, preferred currency per item
- 📋 **Quick actions**: iOS Shortcuts, clipboard entry, batch editing, natural-language parsing
- 🎨 **Deeply customizable**: dark mode, custom CSS, configurable keyboard

*…and plenty more to discover ✨*

---

## 🚀 Install & Run

### Option 1: Pre-built Installer (recommended)

Grab the installer for your platform from the [Releases page](https://github.com/glink25/centx/releases/latest):

| Platform | Format |
|----------|--------|
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| macOS (Intel) | `.dmg` (x86_64) |
| Windows | `.msi` / `.exe` |
| Linux | `.AppImage` / `.deb` / `.rpm` |
| iOS | *No Tauri-built IPA yet* — [build it yourself](../src-tauri/docs/README_TAURI.md) or install the Swift-native edition from the App Store |
| Android | `.apk` |

On first launch the app walks you through GitHub / Gitee login or WebDAV setup, then you can start recording. The desktop build ships with in-app auto-update (`tauri-plugin-updater`).

### Option 2: Keep Using the Web Version

If you don't need the three enhancements above, the original web version is still maintained: <https://cent.linkai.work>

### Option 3: Build From Source

```bash
# Clone
git clone https://github.com/glink25/centx.git
cd centx

# Install dependencies
pnpm install

# Desktop dev (current host)
pnpm tauri dev

# Release build (Apple Silicon example)
pnpm build:macos
```

See [`src-tauri/docs/README_TAURI.md`](../src-tauri/docs/README_TAURI.md) for full desktop build notes, plus the [Android guide](../src-tauri/docs/ANDROID.md), [Windows signing](../docs/release/windows-signing.md), and [macOS signing](../docs/release/macos-signing.md).

---

## 🔌 Enable the Agent Skill (Desktop Only)

1. Open CentX desktop and go to **Settings → Agent API**.
2. Enable the local API service. The app issues a local token and base URL (default `http://127.0.0.1:<port>`).
3. Click **Export Skill** to obtain a `SKILL.md`.
4. Drop it where your agent tool looks for skills:
   - **Cursor**: `.cursor/skills/cent-ledger-agent-api/SKILL.md`
   - **Claude Code / Codex CLI**: follow each tool's skill / tools convention
5. Prompt the agent with something like:

   > "Analyze this month's Alipay statement, aggregate by category, and write the result into CentX."

The agent reads the Skill and drives CentX through the local HTTP interface.

> 📎 In-repo example: [`.cursor/skills/cent-ledger-agent-api/SKILL.md`](../.cursor/skills/cent-ledger-agent-api/SKILL.md)

---

## 🔁 CentX vs. Cent at a Glance

| Aspect | Cent (Web) | CentX (Tauri) |
|--------|------------|---------------|
| Form factor | PWA web app | Native client (desktop + mobile) |
| Offline availability | Depends on browser cache | Native app, fully offline |
| WebDAV / AI | Subject to CORS | Direct connection, no proxy |
| Agent Skill | ❌ | ✅ (desktop) |
| Auto-update | Browser refresh | Built-in updater |
| Ledger storage | GitHub / Gitee / WebDAV | GitHub / Gitee / WebDAV (fully compatible) |

**Data is fully interchangeable**: the same GitHub repository or WebDAV account works in both web Cent and CentX — switch freely at any time.

---

## 💬 Feedback & Contributing

Issues and PRs are very welcome:

- 🐛 [Bug report](https://github.com/glink25/centx/issues/new?template=bug_report.yml)
- 💡 [Feature request](https://github.com/glink25/centx/issues/new?template=feature_request.yml)
- 📖 [Contribution guide](../docs/contributing/feature-development-guide.md)
- 💬 QQ group: `861180883`

---

## 📜 License

Licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**:

- Share, remix, and redistribute freely
- Attribution to the original author is required
- **No commercial use**
- Derivative works must use the same license

---

## ☕️ Buy Me a Coffee

CentX is currently maintained by a single developer. If it saves you time, consider supporting further development.

<details>
<summary>Click to expand</summary>

### 💰 Alipay

<img src="https://glink25.github.io/post-assets/sponsor-alipay.jpg" width="50%" alt="Alipay QR Code">

### 🌐 Solana (SOL)

**Wallet address:**

`vEzM9jmxChx2AoMMDpHARHZcUjmUCHdBShwF9eJYGEg`

<img src="https://glink25.github.io/post-assets/sponsor-solana.jpg" width="50%" alt="Solana QR Code">

</details>
