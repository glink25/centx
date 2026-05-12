# Release 签名与多平台打包

本目录整理 `cent` 从源码到各平台可信分发的全流程方案，重点解决两个问题：

1. macOS / Windows 用户下载安装包时被系统判定为"恶意软件" — 根因是缺少操作系统级代码签名（Gatekeeper / SmartScreen 不认可 minisign 签名）。
2. 当前 GitHub Actions 仅产出 desktop 三平台产物，没有 Android APK/AAB。

## 当前 release 流程概览

- 触发条件：推送 `v*` tag 或在 Actions 页面手动 `workflow_dispatch`。
- 工作流文件：[`.github/workflows/release.yml`](../../.github/workflows/release.yml)（完整发版）+ [`.github/workflows/release-web.yml`](../../.github/workflows/release-web.yml)（仅 Web bundle）。
- 桌面 matrix：`macos-latest` (aarch64 + x86_64)、`ubuntu-22.04`、`windows-latest`，统一通过 `tauri-apps/tauri-action@v0` 构建并生成 `latest.json` 供 `tauri-plugin-updater` 消费。
- 已有的 `TAURI_SIGNING_PRIVATE_KEY` 是 **minisign** 密钥，**只用于 updater 校验差分包**，不能让 Gatekeeper / SmartScreen 信任。

## 现存问题

| 问题 | 表现 | 解决方案 |
|---|---|---|
| macOS 未做 Developer ID 签名+公证 | 双击 dmg 提示"无法验证开发者，可能含有恶意软件" | 见 [macos-signing.md](./macos-signing.md) |
| Windows 未做代码签名 | 运行 .exe/.msi 触发 SmartScreen "未知发布者"蓝屏 | 见 [windows-signing.md](./windows-signing.md)（SignPath Foundation 免费方案） |
| 缺少 Android CI 打包 | 每次发版需本地 `pnpm build:android` | 见 [android-build.md](./android-build.md) |
| 未上架 Google Play | 仅能侧载 APK，无应用商店分发 | 见 [google-play.md](./google-play.md) |
| Linux 是否需要签名 | 否，无统一信任链，AppImage/deb/rpm 可直接运行；现有 minisign 已足够 updater 校验 | — |

## 文档导航

- [macOS 代码签名 + 公证](./macos-signing.md)
- [Windows 代码签名（Azure Trusted Signing）](./windows-signing.md)
- [Android APK + AAB 自动打包](./android-build.md)
- [Google Play 上架](./google-play.md)

## 推荐实施顺序

1. **Android 自动打包**：无需外部账号审核，最快落地，立即缓解"无 Android 包"问题。
2. **macOS 签名 + 公证**：已有 Apple Developer 账号，按文档配置 Secrets 后即生效。
3. **Windows Azure Trusted Signing**：需 Azure 身份审核（约 3 工作日），可与上一步并行启动申请。
4. **Google Play 上架**：审核耗时长（首次 1-7 天），尽早提交。

## GitHub Secrets 总览

下表汇总所有平台所需 Secrets，便于在 GitHub 仓库 `Settings → Secrets and variables → Actions` 一次性配置。各 Secret 的来源与用法见对应分平台文档。

| 平台 | Secret 名 | 用途 |
|---|---|---|
| 通用（已有） | `TAURI_SIGNING_PRIVATE_KEY` | tauri-updater 差分包签名 |
| 通用（已有） | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 同上 |
| macOS | `APPLE_CERTIFICATE` | Developer ID p12 (base64) |
| macOS | `APPLE_CERTIFICATE_PASSWORD` | p12 密码 |
| macOS | `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| macOS | `APPLE_ID` | Apple ID 邮箱 |
| macOS | `APPLE_PASSWORD` | App-Specific Password |
| macOS | `APPLE_TEAM_ID` | 10 位 Team ID |
| macOS | `KEYCHAIN_PASSWORD` | CI 临时 keychain 密码（随机） |
| Windows | `AZURE_TENANT_ID` | Azure AD 租户 |
| Windows | `AZURE_CLIENT_ID` | Azure App Registration |
| Windows | `AZURE_CLIENT_SECRET` | Azure App 凭据 |
| Windows | `AZURE_TS_ENDPOINT` | 如 `https://eus.codesigning.azure.net/` |
| Windows | `AZURE_TS_ACCOUNT_NAME` | Trusted Signing Account 名 |
| Windows | `AZURE_TS_PROFILE_NAME` | Certificate Profile 名 |
| Android | `ANDROID_KEYSTORE_BASE64` | upload-keystore.jks (base64) |
| Android | `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| Android | `ANDROID_KEY_ALIAS` | key 别名（如 `upload`） |
| Android | `ANDROID_KEY_PASSWORD` | key 密码 |
| Play Store (可选) | `PLAY_SERVICE_ACCOUNT_JSON` | Play Developer API 服务账号 |
