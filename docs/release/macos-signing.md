# macOS 代码签名 + 公证

本文说明如何为 `cent` 的 macOS 产物（.app / .dmg）启用 Apple Developer ID 签名 + Notarization，让用户下载后双击直接打开，不再触发 Gatekeeper "无法验证开发者"警告。

## 原理：为什么 minisign 不够

macOS 的 Gatekeeper 在用户首次打开 quarantine 文件时会校验三件事：

1. **Developer ID Application 签名**：可执行文件需用 Apple CA 链颁发的 Developer ID Application 证书签名。
2. **Notarization（公证）**：把签名后的产物上传给 Apple，由其自动扫描已知恶意特征并签发"公证票据"。
3. **Stapling**：把公证票据嵌入产物文件，离线也能通过校验。

当前仓库的 `TAURI_SIGNING_PRIVATE_KEY` 是 **minisign** 密钥，仅给 `tauri-plugin-updater` 校验差分包 hash 用，Gatekeeper 不认。三步全做齐才会无警告。

## 一次性准备

### 1. 申请 Developer ID Application 证书

1. 登录 [Apple Developer](https://developer.apple.com/account/resources/certificates/list)。
2. 选 `Certificates` → `+` → 类型 **Developer ID Application**（不是 "Apple Development" 也不是 "Mac Installer"）。
3. 按提示用钥匙串"证书助理"生成 CSR 并上传，下载 `.cer` 文件双击导入到本机钥匙串。

### 2. 导出 p12 并 base64 编码

在"钥匙串访问"找到刚导入的 `Developer ID Application: 你的名字 (TEAMID)`，右键导出为 `.p12`，设置一个强密码（之后会作为 `APPLE_CERTIFICATE_PASSWORD`）。

```bash
base64 -i developer-id.p12 | pbcopy
# 剪贴板内容就是 APPLE_CERTIFICATE 的值
```

### 3. 创建 App-Specific Password

1. 登录 [appleid.apple.com](https://appleid.apple.com) → "登录与安全" → "App 专用密码"。
2. 生成一个标签为 `cent-notarize` 的密码，记录下来（之后填入 `APPLE_PASSWORD`，注意这**不是**你的 Apple ID 主密码）。

### 4. 获取 Team ID

[Apple Developer 主页](https://developer.apple.com/account) 右上角 "Membership details" 中的 10 位字符串。

### 5. 校验 Signing Identity 全称

```bash
security find-identity -v -p codesigning
# 输出类似：1) ABCD... "Developer ID Application: Your Name (TEAMID)"
```

引号内字符串就是 `APPLE_SIGNING_IDENTITY`。

## GitHub Secrets 配置

在仓库 `Settings → Secrets and variables → Actions` 新建：

| Secret | 取值来源 |
|---|---|
| `APPLE_CERTIFICATE` | 第 2 步 base64 字符串 |
| `APPLE_CERTIFICATE_PASSWORD` | 第 2 步导出 p12 时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | 第 5 步的引号内全称 |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_PASSWORD` | 第 3 步的 App-Specific Password |
| `APPLE_TEAM_ID` | 第 4 步的 Team ID |
| `KEYCHAIN_PASSWORD` | 随便填一个强随机字符串（仅 CI 内创建临时 keychain 用，不复用） |

## Workflow 接入

只需要在 [`.github/workflows/release.yml`](../../.github/workflows/release.yml) 的 macOS matrix `Build & release with tauri-action` 步骤 `env:` 块里追加变量，`tauri-action` 内置逻辑会自动创建临时 keychain、导入证书、签名、调用 `xcrun notarytool submit --wait`、`stapler staple`：

```yaml
- name: Build & release with tauri-action
  uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    # ↓↓↓ 新增 ↓↓↓
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
  with:
    tagName: ${{ steps.tag.outputs.tag }}
    releaseName: "cent ${{ steps.tag.outputs.tag }}"
    releaseDraft: true
    prerelease: false
    includeUpdaterJson: true
    updaterJsonPreferNsis: true
    args: ${{ matrix.args }}
```

`src-tauri/tauri.conf.json` 中 `bundle.macOS` 不需要写 `signingIdentity`（留空时 `tauri-action` 会用 env 注入的值）。Hardened Runtime 已在配置中启用，公证一次过的必要条件全部满足。

## 验证

CI 跑完后，从 draft release 下载 `cent_<version>_aarch64.dmg`，本地执行：

```bash
# 1) 检查签名
codesign -dv --verbose=4 /Applications/cent.app
# 期望出现：Authority=Developer ID Application: ...

# 2) 检查公证票据
spctl --assess --type execute --verbose /Applications/cent.app
# 期望：accepted source=Notarized Developer ID

# 3) 检查 stapler
stapler validate /Applications/cent.app
# 期望：The validate action worked!
```

双击 dmg → 拖到 Applications → 首次启动应**无任何弹窗**。

## 常见问题

- **`errSecInternalComponent`**：CI 临时 keychain 未解锁。检查 `KEYCHAIN_PASSWORD` 是否设置。
- **`The signature of the binary is invalid`**：通常是 entitlements 文件缺 hardened runtime。`tauri.conf.json` 默认已开启，无需手动改。
- **公证超时 / 状态 `In Progress`**：Apple 公证服务偶发慢，可在 `notarytool submit` 加 `--timeout 1800` 容忍 30 分钟；超时后重试发版即可。
- **Team ID 错**：`APPLE_SIGNING_IDENTITY` 末尾括号里的 Team ID 必须与 `APPLE_TEAM_ID` 一致，否则证书匹配失败。
- **证书过期**：Developer ID Application 证书有效期 5 年，到期后需重新生成 p12 并更新 `APPLE_CERTIFICATE`；已发布的产物因为已 staple 公证票据，不受证书过期影响（票据本身长期有效）。
