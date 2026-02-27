使用tauri开发时对应端App时，需要按照不同平台差异进行配置：

## iOS

需要提前安装Xcode

```
# 初始化项目
pnpm tauri ios init

# 更新图标
pnpm tauri icon ./public/logo.png

```
Info.plist
需要配置xcode项目的网络访问权限
```
App Transport Security Settings
Allow Arbitrary Loads yes
```
还需要手动配置deep-link，在URL types中添加"dailycent"，才能正常触发OAuth回调

## Android

Android 端需要先安装 JDK、Android Studio 与 NDK，并配置环境变量后再执行初始化。完整步骤见 [Android 开发文档](./ANDROID.md)。

```bash
# 首次需先初始化 Android 工程（生成 src-tauri/gen/android）
pnpm tauri android init

# 开发调试（需连接真机或启动模拟器）
pnpm dev:android
# 或指定 ABI：pnpm tauri android dev --target arm64-v8a

# 构建 Release APK/AAB
pnpm build:android
```

- **Deep Link**：已在 `tauri.conf.json` 的 `plugins.deep-link.mobile` 中配置 `scheme: ["dailycent"]`，与 [DEEP_LINK_SERVER.md](./DEEP_LINK_SERVER.md) 中的 Android App Links 配合使用。
- **包名**：与 `identifier` 一致，为 `com.glink.dailycent`（assetlinks 中的 `package_name` 需与此一致）。