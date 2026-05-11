使用tauri开发时对应端App时，需要按照不同平台差异进行配置：

## 桌面（macOS / Linux / Windows）

`src-tauri/tauri.conf.json` 中 **`bundle.targets`** 为 **`"all"`**，并在 `bundle` 下配置了 `linux` / `macOS` / `windows` 的打包选项；在本机执行 `tauri build` 时会生成**当前平台**对应的安装包格式（如 `.deb` / AppImage、`.dmg`、NSIS / MSI 等，以 CLI 输出为准）。

**官方前置条件（含各系统依赖）：** [Tauri 2 Prerequisites](https://v2.tauri.app/start/prerequisites/)

- **macOS**：需安装 Xcode / Command Line Tools；Apple Silicon 常用目标为 `aarch64-apple-darwin`，Intel Mac 为 `x86_64-apple-darwin`。若需通用二进制（Universal），需分别在两个目标上构建后再用 `lipo` 合并，见 Apple 与 Rust 交叉编译文档。
- **Linux**：需安装 **WebKitGTK** 等开发包（具体包名见上方官方链接中的 Linux 小节）。
- **Windows**：需 **Visual Studio Build Tools**（ MSVC ）与 **WebView2**（运行时装载；安装器行为见 `bundle.windows.webviewInstallMode`）。

**仓库内常用命令：**

```bash
# 前端（Tauri dev 会通过 beforeDevCommand 自动拉起）
pnpm dev

# 桌面开发（任选与平台对应的脚本，实际均为 tauri dev）
pnpm dev:macos
pnpm dev:linux
pnpm dev:windows

# 发布构建（在对应系统上执行；首次请按目标安装 rustup target）
pnpm build:macos          # Apple Silicon
pnpm build:macos:intel    # Intel macOS
pnpm build:linux          # x86_64 GNU Linux
pnpm build:windows        # x86_64 Windows MSVC
```

在任一桌面系统上也可直接使用 `pnpm tauri dev` / `pnpm tauri build`（当前宿主默认目标）。**无法从单一开发机无依赖地「一次构建出三端」**；若需集中产出，请使用 CI（见仓库 `.github/workflows/release.yml`）在 macOS / Linux / Windows 的 GitHub Actions runner 上分别构建。

**Deep Link（桌面）：** 已在 `tauri.conf.json` 的 `plugins.deep-link.desktop.schemes` 中配置 `dailycent`；安装后由系统按平台注册自定义协议，OAuth 等流程可与 [DEEP_LINK_SERVER.md](./DEEP_LINK_SERVER.md) 中的移动端说明一并对照（桌面无 App Links，主要为 URL scheme）。

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