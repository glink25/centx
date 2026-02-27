# Tauri 2 Android 端开发文档

本文档说明如何在当前 cent 项目中配置环境、初始化、开发与构建 Android 应用。

## 一、环境准备

### 1. 必需软件

| 依赖 | 说明 |
|------|------|
| **JDK 17** | 推荐 OpenJDK 17。macOS 可用：`brew install openjdk@17`，或者使用zulu：`brew install --cask zulu@17`，并设置 `JAVA_HOME`。 |
| **Android Studio** | 从 [developer.android.com/studio](https://developer.android.com/studio) 下载安装。 |
| **NDK (Side by side)** | 在 Android Studio：Settings → Languages & Frameworks → Android SDK → SDK Tools → 勾选 “NDK (Side by side)” 并安装。记下安装的 NDK 版本号（如 `27.x.x`）。 |

### 2. 环境变量

在 `~/.zshrc` 或 `~/.bash_profile` 中配置（路径按本机实际安装调整）：

```bash

export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
# Android SDK（macOS 默认路径）
export ANDROID_HOME=$HOME/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk | head -1) # 自动指向最新版NDK
export TOOLCHAIN=$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools


```

执行 `source ~/.zshrc` 后可用以下命令验证：

```bash
echo $JAVA_HOME
echo $ANDROID_HOME
echo $NDK_HOME
```

### 3. Rust Android 目标

安装 Tauri 构建 Android 所需的 target：

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

---

## 二、项目初始化

**首次** 为当前 Tauri 项目添加 Android 支持时，在仓库根目录执行：

```bash
# 若在 CI 或非交互环境，可设置 CI=1 跳过交互
pnpm tauri android init
```

该命令会：

- 在 `src-tauri/gen/android` 下生成 Android Gradle 工程；
- 根据 `tauri.conf.json` 的 `identifier`（如 `com.glink.dailycent`）配置包名；
- 使用 `bundle.android` 中的 `minSdkVersion`（本项目为 24）等配置。

**注意**：若报错 `ANDROID_HOME` / `NDK_HOME` 未设置，请回到「环境准备」检查环境变量是否生效。

---

## 三、开发与调试

### 1. 连接设备

- **真机**：开启开发者选项与 USB 调试，用数据线连接电脑，执行 `adb devices` 确认设备已列出。
- **模拟器**：在 Android Studio 的 Device Manager 中创建并启动 AVD。

### 2. 运行开发版

在项目根目录执行：

```bash
# 使用 package.json 中配置的 aarch64 目标（常见真机/模拟器）
pnpm dev:android
```

或直接使用 Tauri CLI 指定 ABI：

```bash
# 真机常用
pnpm tauri android dev --target aarch64-linux-android

# x86_64 模拟器
pnpm tauri android dev --target x86_64-linux-android
```

首次运行会编译 Rust 与前端，并安装 Debug APK 到设备。之后会监听前端变更并热重载。

### 3. 调试

- **Chromium DevTools**：在桌面 Chrome 地址栏输入 `chrome://inspect/#devices`，选择你的设备与 WebView 进行调试。
- **日志**：`adb logcat` 可查看应用与 Tauri 相关日志。

---

## 四、构建 Release

在项目根目录执行：

```bash
# 构建 aarch64 Release（与 dev:android 对应）
pnpm build:android
```

或使用 Tauri CLI 指定目标：

```bash
pnpm tauri android build --target aarch64-linux-android
```

产物位置（在 `src-tauri/gen/android` 下，具体路径以 CLI 输出为准）：

- **APK**：`app/build/outputs/apk/` 或 `app/build/outputs/apk/release/`
- **AAB（Google Play）**：`app/build/outputs/bundle/release/`

如需 **多 ABI 打包**，可多次执行 `tauri android build --target <abi>`，或参考 Tauri 官方文档配置 Gradle 多 ABI 构建。

---

## 五、与当前项目的对应关系

### 1. 包名与 identifier

- `tauri.conf.json` 中 `identifier` 为 `com.glink.dailycent`。
- Android 包名与之一致，用于：
  - 生成 `src-tauri/gen/android` 工程；
  - 服务端 [DEEP_LINK_SERVER.md](./DEEP_LINK_SERVER.md) 中 Android App Links 的 `assetlinks.json` 的 `package_name`（需为 `com.glink.dailycent`）。

### 2. Deep Link

- 已在 `tauri.conf.json` → `plugins.deep-link.mobile` 中配置 `scheme: ["dailycent"]`，支持通过 `dailycent://...` 唤起 App。
- 若需 Android App Links（`https://cent.linkai.work/open/...` 直接打开 App），需在服务端配置 `assetlinks.json`，并在 `sha256_cert_fingerprints` 中填写本应用签名证书的 SHA256。详见 [DEEP_LINK_SERVER.md](./DEEP_LINK_SERVER.md)。

### 3. 版本与 minSdk

- 应用版本由 `tauri.conf.json` 的 `version` 控制。
- `bundle.android` 中已配置：
  - `minSdkVersion: 24`
  - `autoIncrementVersionCode: false`（如需每次构建自增 versionCode，可改为 `true`，并视情况将 `tauri.properties` 从 `.gitignore` 中移除以便提交）。

---

## 六、常见问题

| 现象 | 处理 |
|------|------|
| `ANDROID_HOME` / `NDK_HOME` 未设置 | 确认已安装 Android SDK/NDK，并在当前 shell 中正确设置并导出环境变量。 |
| `tauri android init` 失败 | 确保在仓库根目录执行，且已执行过 `pnpm install`；非交互环境可设 `CI=1`。 |
| 真机/模拟器不显示 | 运行 `adb devices`，确认设备为 `device` 状态；模拟器需先完全启动。 |
| 构建报错找不到 NDK | 检查 `NDK_HOME` 路径是否与 Android Studio 中安装的 NDK 版本路径一致。 |
| Deep Link 不唤起 App | 检查 scheme 是否为 `dailycent`；若用 App Links，确认 `assetlinks.json` 与签名指纹正确且可访问。 |

更多可参考 [Tauri 官方文档 - Android 前置条件](https://v2.tauri.app/start/prerequisites/#android)。
