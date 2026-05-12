# Google Play 上架

本文说明把 [Android 构建流程](./android-build.md) 产出的 AAB 提交到 Google Play 的完整流程，并给出 CI 自动上传到 Internal Testing 渠道的可选方案。

## 1. 注册 Play Console 开发者账号

1. 访问 [play.google.com/console](https://play.google.com/console)，用 Google 账号登录。
2. 选账号类型：**Personal**（个人，无需企业资质）或 **Organization**（公司，需 D-U-N-S 编号）。
3. 支付 **$25 一次性**注册费（信用卡，VISA/Master）。
4. 完成身份验证：上传身份证 / 护照，2024 年起 Google 对个人开发者强制要求实名验证；新账号还需"封闭测试 14 天，≥12 人测试"才能首次发 production——这是硬性新规，预留时间。

## 2. 创建应用

Play Console → "All apps" → **Create app**：

| 字段 | 填写 |
|---|---|
| App name | `cent`（可改） |
| Default language | 简体中文 / English（按目标受众） |
| App or game | App |
| Free or paid | Free |
| Declarations | 勾选两项政策同意 |

创建后进入应用的 "Dashboard"，左侧导航有一长串"Set up your app"清单，逐项填写：

- **App access**：是否需要登录访问 → 如有登录给测试账号
- **Ads**：是否含广告
- **Content rating**：填问卷，自动生成评级
- **Target audience**：年龄段
- **News app / Government app / Health / Financial**：按实际勾选
- **Data safety**：⚠️ 重要！声明应用收集哪些用户数据、是否加密、是否分享给第三方。`cent` 若涉及第三方 OAuth、同步、HTTP 调用都需如实列出
- **Government apps / COVID-19 apps**：通常无需勾选
- **Privacy Policy URL**：**必填**。需要一个公网可访问的隐私政策页（最简单：在 GitHub Pages 或仓库 README 之外单独建 `PRIVACY.md` 渲染页）
- **App category**：选最匹配的（如 Productivity）
- **Store listing**：标题（30 字符）/ 简短描述（80 字符）/ 完整描述（4000 字符）/ 图标（512×512 PNG）/ 主图（1024×500）/ 截图（手机至少 2 张 16:9 或 9:16）

## 3. Play App Signing（关键安全机制）

Google Play 默认启用 **Play App Signing**：

- 你上传的 keystore（`upload-keystore.jks`）= **upload key**，仅用于向 Play 证明"是你"。
- Google 自己生成一把 **app signing key**，最终分发给用户的 APK 是用 app signing key 重签的。
- **upload key 丢失可以重置**（联系 Play 支持 + 用账号验证），app signing key 由 Google 永久托管不会丢。

实操：

1. 应用左侧导航 → **Release** → **Setup** → **App signing**。
2. 默认已勾选"Use Play App Signing"。Google 给两种方式：
   - **Let Google create and manage app signing key**：最省事，推荐。
   - **Export and upload a key**：自己掌控 app signing key，丢失风险全部自担，不推荐。
3. 选第一种后，无需额外操作；之后上传 AAB 时 Google 自动用 upload key 校验、用 app signing key 重签。

## 4. 首次发布到 Internal Testing

1. **Testing → Internal testing → Create new release**。
2. 上传 [android-build.md](./android-build.md) 流程产出的 `*.aab`（不是 APK）。
3. Release name 默认填 versionName，Release notes 写中文/英文双版本。
4. **Testers** 标签页 → 添加测试组：填一组 Gmail 邮箱（自己 + 朋友 ≥ 12 个，配合 Google 14 天测试要求）。
5. 复制"Opt-in URL"发给测试者，他们点开即可加入测试组并通过 Play 安装 `cent`。
6. **Review release → Start rollout to internal testing**。Internal track 通常 **几分钟**审核通过。

后续升级到 Closed / Open / Production 渠道，每次只需点 "Promote release" 即可，无需重新上传。

## 5. CI 自动上传到 Internal Track（可选）

手动每次发版都点上传太繁琐。可用 [`r0adkll/upload-google-play`](https://github.com/r0adkll/upload-google-play) 把 CI 产出的 AAB 直接发到 Play。

### 5.1 创建 Play Developer API 服务账号

1. Play Console → **Setup → API access**。
2. 链接到一个 Google Cloud project（首次会引导创建）。
3. **Create new service account** → 跳转 Google Cloud Console → 创建一个 service account（如 `cent-play-publisher`）→ 生成 JSON key → 下载。
4. 回到 Play Console API access 页 → 在服务账号列表点 **Grant access** → 权限至少给：
   - **Release manager** 角色（或更细：Releases to testing tracks）
   - 应用范围：只勾 `cent`

### 5.2 GitHub Secret 配置

把下载的 JSON 文件**整段内容**作为 secret 值：

| Secret | 内容 |
|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON` | JSON 全文 |

### 5.3 在 android job 末尾追加

```yaml
      - name: Upload AAB to Play Internal track
        if: startsWith(github.ref, 'refs/tags/v')
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.glink.dailycent
          releaseFiles: android-out/*.aab
          track: internal
          status: completed
          inAppUpdatePriority: 2
          whatsNewDirectory: ./play-whatsnew  # 可选：放每语言的 release notes
```

> `packageName` 必须与 `src-tauri/tauri.conf.json` 中 `identifier` 一致。

## 6. 验证

- Internal track 上传后，几分钟内测试者 Play 商店"我的应用"中应能看到更新。
- 若长时间没出现：检查 service account 权限、AAB 版本号是否大于上一次（versionCode 必须单调递增）。
- 应用页 **Release → Bundle explorer** 可逐个 AAB 看签名信息、ABI 切分、大小、所含权限。

## 常见问题

- **首次发 Production 被卡 "14 天测试 + 12 测试者"**：2024 年 11 月起的新规，没法绕过；提前 2 周拉 12 个测试者加入 Internal/Closed track。
- **`Package not found`**：第一次手动上传 AAB 前，Play 还没识别包名；先在 Internal track 手动传一次后，CI 自动上传才能找到。
- **`Version code XXX has already been used`**：`versionCode` 必须严格递增。Tauri v2 默认从 `tauri.conf.json` 的 `version` 推算，确保每次发版都升号；或在 `build.gradle.kts` 中手动 `versionCode = System.getenv("VERSION_CODE")?.toInt() ?: 1` 并在 CI 注入。
- **隐私政策被拒**：必须是公网可访问的稳定 URL（GitHub repo 链接不行，需 GitHub Pages 或自建站点），且必须列出**所有**第三方 SDK / API 收集的数据。
- **目标 API 等级低**：Play 每年提高 targetSdk 最低要求；Tauri 默认跟最新，但本地构建过旧版需在 `build.gradle.kts` 同步 `targetSdk`。
- **Data safety 与代码不一致**：Play 会在上架后定期扫描你的 AAB，如果实际收集的数据（如 ANDROID_ID、网络请求 IP）和声明不一致会下架；保守列出更多项总比漏报安全。

## 与 keystore 的双重备份

- **upload key（你的 `upload-keystore.jks`）** + GitHub Secrets 副本 + 本地加密备份 ≥ 2 份。
- **service account JSON** 同样备份；如果泄漏，立刻在 Google Cloud Console 旋转 key 并更新 GitHub Secret。
- **app signing key** 由 Google 托管，无需备份。
