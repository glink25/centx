# Android APK + AAB 自动打包

本文说明如何为 `cent` 在 GitHub Actions 中自动构建签名后的 Android APK 和 AAB，并上传到 GitHub Release。APK 用于侧载，AAB 用于 [Google Play 上架](./google-play.md)。

## 前置依赖

Tauri v2 的 `tauri android build` 需要构建机器具备：

- **JDK 21**（Temurin）
- **Android SDK**（platform-tools, build-tools, platform 34+）
- **Android NDK**（推荐 `27.0.12077973`，与 Tauri 2.x 兼容性最好）
- **Rust 稳定版 + Android targets**：`aarch64-linux-android` / `armv7-linux-androideabi` / `i686-linux-android` / `x86_64-linux-android`
- **Release keystore**：debug keystore 不会被 Android 安装器接受（应用商店更不行）。

仓库 `src-tauri/gen/android/` 已由 `tauri android init` 生成。`tauri.conf.json` 已配置 `minSdkVersion: 24` 与 deep-link scheme。

## 一次性准备：生成 Release Keystore

```bash
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 \
  -validity 10000 \
  -storepass <一个强密码> \
  -keypass  <一个强密码> \
  -dname "CN=cent, OU=cent, O=glink, L=, S=, C=CN"
```

记录：
- keystore 密码 → `ANDROID_KEYSTORE_PASSWORD`
- key 密码 → `ANDROID_KEY_PASSWORD`（实践中可与 keystore 同密码）
- alias → `ANDROID_KEY_ALIAS`（如 `upload`）

**安全存档**：把 `upload-keystore.jks` 备份到 1Password / Bitwarden / 加密 U 盘 **至少两份**。一旦丢失：
- 没上架 Play：仅影响升级路径，旧用户需卸载重装。
- 已上架 Play：见 [google-play.md](./google-play.md) "Play App Signing"，可通过 Google 申请 upload key 重置（不会丢失签名 key）。

base64 编码用于 GitHub Secret：

```bash
base64 -i upload-keystore.jks | pbcopy
# 内容即 ANDROID_KEYSTORE_BASE64
```

## GitHub Secrets 配置

| Secret | 取值 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 上面剪贴板内容 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | key 密码 |

## 修改 `build.gradle.kts`

`src-tauri/gen/android/app/build.gradle.kts` 是 `tauri android init` 生成的。需要让它在 CI 环境通过环境变量读 keystore，本地开发（无环境变量时）保持现状走 debug 签名。

在 `android { ... }` 块中追加：

```kotlin
android {
    // ... 现有内容 ...

    signingConfigs {
        create("release") {
            val ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ksPath != null && file(ksPath).exists()) {
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            // 仅在 keystore 可用时启用 release signing；否则 Gradle 跳过签名（CI 会失败但本地仍可 debug 构建）
            if (System.getenv("ANDROID_KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = false
        }
    }
}
```

> 不需要把任何凭据写进 `build.gradle.kts` 或 `gradle.properties`，全部通过环境变量注入，避免误提交。

## 新增 Workflow Job

在 [`.github/workflows/release.yml`](../../.github/workflows/release.yml) 末尾、`web-bundle` job 之后追加：

```yaml
  android:
    runs-on: ubuntu-22.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with: { version: 9 }

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
        with:
          packages: "platform-tools platforms;android-34 build-tools;34.0.0"

      - name: Install NDK
        run: |
          sdkmanager --install "ndk;27.0.12077973"
          echo "NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973" >> $GITHUB_ENV

      - name: Rust stable + Android targets
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: "./src-tauri -> target"

      - name: Install JS dependencies
        run: pnpm install --frozen-lockfile

      - name: Resolve tag
        id: tag
        shell: bash
        run: |
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            echo "tag=${{ github.event.inputs.tag }}" >> "$GITHUB_OUTPUT"
          else
            echo "tag=${GITHUB_REF#refs/tags/}" >> "$GITHUB_OUTPUT"
          fi

      - name: Decode keystore
        env:
          KS: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: echo "$KS" | base64 -d > "$RUNNER_TEMP/upload-keystore.jks"

      - name: Build APK + AAB
        env:
          ANDROID_KEYSTORE_PATH: ${{ runner.temp }}/upload-keystore.jks
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          pnpm exec tauri android build --apk --aab

      - name: Collect artifacts
        id: collect
        run: |
          mkdir -p android-out
          # universal APK / AAB 路径（Tauri v2 默认产物布局）
          cp src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk android-out/ 2>/dev/null || true
          cp src-tauri/gen/android/app/build/outputs/bundle/universalRelease/*.aab android-out/ 2>/dev/null || true
          # 兼容老版本分 ABI 产物
          find src-tauri/gen/android/app/build/outputs -name "*-release*.apk" -exec cp {} android-out/ \;
          find src-tauri/gen/android/app/build/outputs -name "*-release*.aab" -exec cp {} android-out/ \;
          ls -la android-out/

      - name: Upload to GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release upload "${{ steps.tag.outputs.tag }}" android-out/* --clobber
```

> 若 release 是 draft（`releaseDraft: true`），`gh release upload` 也能上传到 draft，无需特殊处理。

## 验证

1. **签名校验**：
   ```bash
   $ANDROID_HOME/build-tools/34.0.0/apksigner verify --verbose cent-universal-release.apk
   # 期望：Verified using v2 scheme (APK Signature Scheme v2): true
   #       Verified using v3 scheme (APK Signature Scheme v3): true
   ```
2. **真机安装**：
   ```bash
   adb install -r cent-universal-release.apk
   ```
3. **检查 AAB**：
   ```bash
   # 用 bundletool 生成 universal apks 测试
   bundletool build-apks --bundle=cent-universalRelease.aab --output=test.apks --mode=universal
   ```

## 常见问题

- **`NDK not found`**：`tauri android build` 找不到 NDK。确保 workflow 中 `NDK_HOME` 已 export，且 NDK 版本号与 `sdkmanager` 安装的一致。
- **`linker target aarch64-linux-android not found`**：Rust target 没装齐。`dtolnay/rust-toolchain` 的 `targets:` 字段要完整列 4 个 Android target。
- **`Could not find keystore`**：检查 `ANDROID_KEYSTORE_PATH` 绝对路径；base64 解码失败时该文件可能是空。`base64 -d` 失败用 `base64 --decode` 替代（GNU vs BSD 差异）。
- **APK 产物路径不一致**：Tauri 不同版本可能输出到 `outputs/apk/universal/release/` 或按 ABI 分到 `outputs/apk/<abi>/release/`。`Collect artifacts` 步骤用 `find` 兜底。
- **AAB 不能 `adb install`**：AAB 是 Play 用的格式，本地测试装 `bundletool` 转 universal APK。
- **包名冲突**：`tauri.conf.json` 的 `identifier` (`com.glink.dailycent`) 在 Play 商店中必须唯一。如发生冲突需改 identifier，但**改 identifier = 新应用**，旧应用升级路径会断。

下一步：把 AAB 上架，参见 [google-play.md](./google-play.md)。
