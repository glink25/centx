# Deep Link / Universal Link 服务端配置说明

本文档说明如何在站点 **cent.linkai.work** 上配置服务端，以支持 Tauri 客户端的 **Android App Links**、**iOS Universal Links**，以及全平台统一的 **URL Scheme 降级**（`dailycent://`）。

- **优先**：移动端使用 Universal Link / App Link（`https://cent.linkai.work/open/...`），无需用户选择“用 App 打开”。
- **降级**：当 Universal Link 不可用（如部分浏览器、微信内、未验证域名等）时，使用 **dailycent://** 链接即可通过系统 URL Scheme 唤起已安装的 App。全平台（iOS、Android、Windows、macOS、Linux）统一使用 `dailycent://`。

---

## 一、Android App Links

### 1. 端点与路径

- **URL**：`https://cent.linkai.work/.well-known/assetlinks.json`
- **方法**：GET
- **Content-Type**：`application/json`

### 2. 响应体格式

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.glink.dailycent",
      "sha256_cert_fingerprints": [
        "请替换为你的 Android 签名证书 SHA256 指纹"
      ]
    }
  }
]
```

### 3. 参数说明

| 占位符 / 字段 | 说明 |
|---------------|------|
| `package_name` | 与 `tauri.conf.json` 中的 `identifier` 对应，**需将 `-` 改为 `_`**。当前为 `com.glink.dailycent`。 |
| `sha256_cert_fingerprints` | 用于签名 APK 的证书的 SHA256 指纹列表。调试可用 debug keystore 的指纹，正式发布需用 release 签名证书的指纹。 |

### 4. 获取 SHA256 指纹

- **Debug 证书**（示例，以你本机为准）：
  ```bash
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
  ```
- **Release 证书**：用你打包发布时使用的 keystore 执行上述 `keytool -list -v -keystore <你的keystore>`，在输出中复制 “SHA256” 一行，格式为冒号分隔的十六进制（如 `AA:BB:CC:...`），**可保留冒号或去掉均可**，按 Google 文档要求即可。

更多说明见：[Verify Android App Links](https://developer.android.com/training/app-links/verify-android-applinks#web-assoc)。

---

## 二、iOS Universal Links

### 1. 端点与路径

- **URL**：`https://cent.linkai.work/.well-known/apple-app-site-association`
- **注意**：路径**不要**加 `.json` 后缀；Apple 只认无后缀的路径。
- **方法**：GET
- **Content-Type**：`application/json` 或 `application/pkcs7-mime`（推荐 `application/json`）。若为错误类型如 `application/octet-stream`，iOS 可能无法解析。

### 2. 响应体格式

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["你的开发团队ID.com.glink.dailycent"],
        "components": [
          {
            "/": "/open/*",
            "comment": "匹配所有以 /open/ 开头的路径"
          }
        ]
      }
    ]
  }
}
```

### 3. 参数说明

| 占位符 / 字段 | 说明 |
|---------------|------|
| `appIDs` | 格式为 `开发团队ID.包标识`。包标识与 `tauri.conf.json` 的 `identifier` 一致，即 `com.glink.dailycent`。开发团队 ID 来自 Apple Developer 或 Xcode，或在 `tauri.conf.json` 的 `bundle > iOS > developmentTeam` / 环境变量 `TAURI_APPLE_DEVELOPMENT_TEAM` 中配置。 |
| `components[]."/"` | `/open/*` 表示只把以 `/open/` 开头的路径当作 Universal Link 交给 App 处理，与客户端 deep-link 配置中的 `pathPrefix: ["/open"]` 一致。 |

更多说明见：[App Search Programming Guide - Supporting Associated Domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)。

### 4. 服务端注意点

- 该文件必须通过 **HTTPS** 提供，且证书有效。
- 若使用 Nginx，可为该路径单独设置 `default_type application/json;`，避免无扩展名时被当成 `application/octet-stream`。

---

## 三、桌面端（Windows / macOS / Linux）

桌面端使用**自定义 URL Scheme**：全平台统一为 **dailycent://**。无需在 cent.linkai.work 上提供额外文件，系统会直接唤起已安装的 App。从网页跳转示例：

- `dailycent://open/add-bills?text=xxx`
- `dailycent://open/oauth-callback?gitee_authorized=1&...`

---

## 四、URL Scheme 降级（全平台统一 dailycent://）

当 Universal Link / App Link 无法唤起 App 时（如微信内、部分浏览器、未验证域名等），可使用 **dailycent://** 作为降级：

- **iOS / Android**：在 `tauri.conf.json` 的 `plugins.deep-link.mobile` 中已配置 `scheme: ["dailycent"]`，与 Universal Link 并存；用户点击 `dailycent://open/...` 即可打开 App。
- **桌面**：`plugins.deep-link.desktop.schemes` 仅配置 `["dailycent"]`。

前端可用 `@/utils/deep-link` 的 `toDailyCentDeepLink(universalLinkUrl)` 将任意 Universal Link 或路径转为 `dailycent://` 链接，用于“用 App 打开”等降级按钮。

---

## 五、链接格式与路径约定

- **Web / Universal Link / App Link**（优先）：  
  `https://cent.linkai.work/open/...`  
  例如：`https://cent.linkai.work/open/add-bills?text=xxx`
- **降级 / 桌面**（统一 URL Scheme）：  
  `dailycent://open/...`  
  例如：`dailycent://open/add-bills?text=xxx`

路径以 `/open/` 为前缀，与 `tauri.conf.json` 中 `pathPrefix: ["/open"]` 及本文档中 iOS 的 `components` 配置一致。

---

## 六、校验与排查

1. **Android**  
   - 浏览器或 curl 访问：`https://cent.linkai.work/.well-known/assetlinks.json`，确认返回合法 JSON 且 `package_name`、`sha256_cert_fingerprints` 正确。  
   - 使用 [Google 的 Statement List 测试工具](https://developers.google.com/digital-asset-links/tools/generator) 可辅助检查。

2. **iOS**  
   - 使用 curl 查看响应头与内容：  
     `curl -i https://cent.linkai.work/.well-known/apple-app-site-association`  
   - 确认无 `.json` 后缀、Content-Type 为 `application/json`（或 `application/pkcs7-mime`）。  
   - 可用 [Apple 的 AASA 校验工具](https://search.developer.apple.com/appsearch-validation-tool/) 验证。

3. **通用**  
   - 确保域名 cent.linkai.work 的 HTTPS 证书有效，且无重定向到其他域名（部分平台对重定向有限制）。

完成上述配置后，移动端通过 `https://cent.linkai.work/open/...` 的链接即可在已安装 App 时唤起客户端并交由应用内逻辑（如 `useUrlHandler`）处理。
