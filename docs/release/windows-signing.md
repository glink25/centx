# Windows 代码签名（SignPath Foundation）

本文说明如何用 **SignPath Foundation** 为 `cent` 的 Windows 安装包（.exe / .msi）签名。SignPath Foundation 给开源项目**免费**提供 OV 代码签名证书 + 云签名服务 + GitHub Actions 原生集成。

## 为什么选 SignPath Foundation

| 方案 | 年费 | SmartScreen 立即无警告 | CI 友好度 |
|---|---|---|---|
| **SignPath Foundation**（开源） | **$0** | ❌（OV 证书需积累信誉，约 1-3 个月） | ⭐⭐⭐⭐ |
| Azure Trusted Signing | ~$120 | ✅（与 EV 同级即时信誉） | ⭐⭐⭐⭐⭐ |
| Certum Open Source | ~€30 | ❌ | ⭐⭐⭐ |
| EV 证书（DigiCert/Sectigo） | $300+ | ✅ | ⭐⭐（需 HSM 中继） |

`cent` 作为公开 GitHub 仓库满足 SignPath Foundation 申请条件，零成本即可获得真实 OV 证书。签名后效果：

- 用户右键 → "数字签名"显示由 `Certum Code Signing 2021 CA` 签发的 OV 证书，签名者是你的真实身份。
- SmartScreen 首期会显示"不常下载"提示（OV 证书信誉积累期 1-3 个月或累计 ≥ 数千次下载），但**不再出现"未知发布者"红色警告**——这是用户最容易判定为"恶意软件"的那种弹窗。
- 长期免费，不像 Azure 那样每月扣费。

> 若 `cent` 后续闭源或需要立即消除全部警告，参考文末 [附录：Azure Trusted Signing](#附录azure-trusted-signing)。

## 一次性准备：申请 SignPath Foundation

### 1. 注册 SignPath 账号

1. 访问 [signpath.io](https://signpath.io) → Sign up。
2. 用 GitHub 账号登录（推荐，方便后续 OIDC 绑定）。

### 2. 申请 Foundation 项目

1. 进入 [about.signpath.io/foundation](https://about.signpath.io/foundation) → 阅读申请条件：
   - 项目在 GitHub 公开
   - 使用 OSI 认证的开源协议（MIT / Apache-2.0 / GPL 等）
   - 有可识别的真实身份（个人 maintainer 或组织）
2. 在 SignPath Dashboard → `Settings → Project Application → Apply for Foundation`。
3. 填表：
   - **Project name**：`cent`
   - **Repository URL**：`https://github.com/glink25/centx`（或对应仓库）
   - **License**：项目实际协议
   - **Maintainer name + 真实身份**：会用于证书 Subject CN
4. 提交后审核通常 1-5 个工作日。通过后 SignPath 会自动建好 Organization + Project + 默认 Signing Policy。

### 3. 在 SignPath 配置签名策略

审核通过后，进入 SignPath Dashboard：

1. **Project → Artifact Configuration**：定义"提交什么文件、对什么内部内容签名"。默认模板已支持 `.exe` / `.msi` / `.zip` 内含 PE 文件递归签名，无需改。
2. **Project → Signing Policies**：
   - 默认会有一个 `release-signing` 策略。
   - 编辑该策略 → **Origin Verification**：勾选 "Trusted Build Systems" → 选 **GitHub Actions** → 填仓库 `glink25/centx` + workflow 文件 `.github/workflows/release.yml` + 限制 ref 为 `refs/tags/v*`（仅 tag 触发的发版能签）。这一步基于 GitHub OIDC，保证只有你的仓库的 release 流水线能调用签名。
   - **Approvers**：个人 Foundation 项目默认无需人工审批；保留默认。

### 4. 记录三个标识

CI 需要这三个值（不是 secret，可直接写在 workflow 里）：

| 名 | 取值来源 |
|---|---|
| `organization-id` | Dashboard 右上角账号下拉 → Organization → 详情页 UUID |
| `project-slug` | Project 详情页 URL 中的 slug（一般是 `cent`） |
| `signing-policy-slug` | Signing Policy 详情页 URL 中的 slug（如 `release-signing`） |

### 5. 创建 API Token（可选）

如果不用 GitHub OIDC，需要 API Token：Dashboard → `Settings → API Tokens → Create`，权限选 "Submit signing requests"。但**推荐用 OIDC**，零密钥泄漏风险，无需配 Secret，且 SignPath GitHub Action 默认就是 OIDC 模式。

## GitHub Secrets 配置

**用 OIDC 时不需要任何 Secret**，仅需在 workflow `permissions:` 中加 `id-token: write`。

## Workflow 接入

整体流程：

1. `tauri-action` 仍正常出未签名的 .exe / .msi。
2. 用 `actions/upload-artifact` 把产物作为 workflow artifact 暂存（SignPath 需要从 artifact 拉取）。
3. 用 `signpath/github-action-submit-signing-request@v1` 提交签名请求，等服务返回签名后的产物（同步等待 5-10 秒，OIDC 自动鉴权）。
4. 用 minisign 重新对签名产物生成 `.sig`，覆盖上传到 release。

在 [`.github/workflows/release.yml`](../../.github/workflows/release.yml) 中：

```yaml
jobs:
  build:
    permissions:
      contents: write
      id-token: write        # ← 新增，SignPath OIDC 需要
    # ... 现有 strategy/runs-on ...

    steps:
      # ... 现有 checkout / setup / tauri-action 步骤保持不变 ...

      # ↓↓↓ 在 tauri-action 之后，仅 Windows 平台执行 ↓↓↓
      - name: Collect unsigned Windows artifacts
        if: runner.os == 'Windows'
        shell: bash
        run: |
          mkdir -p signpath-in
          cp src-tauri/target/release/bundle/nsis/*.exe signpath-in/ 2>/dev/null || true
          cp src-tauri/target/release/bundle/msi/*.msi signpath-in/ 2>/dev/null || true
          ls -la signpath-in/

      - name: Upload unsigned artifacts (for SignPath)
        if: runner.os == 'Windows'
        id: upload-unsigned
        uses: actions/upload-artifact@v4
        with:
          name: windows-unsigned
          path: signpath-in/
          if-no-files-found: error

      - name: Sign via SignPath
        if: runner.os == 'Windows'
        uses: signpath/github-action-submit-signing-request@v1
        with:
          # OIDC 鉴权，无需 api-token
          organization-id: '<在 SignPath Dashboard 复制的 organization UUID>'
          project-slug: 'cent'
          signing-policy-slug: 'release-signing'
          github-artifact-id: ${{ steps.upload-unsigned.outputs.artifact-id }}
          wait-for-completion: true
          output-artifact-directory: signpath-out

      - name: Re-sign updater & upload signed Windows artifacts
        if: runner.os == 'Windows'
        shell: bash
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          # 1) SignPath 返回的产物覆盖原始 bundle 目录（保证 latest.json hash 算的是签名后版本）
          for f in signpath-out/*.exe; do
            [ -f "$f" ] && cp "$f" "src-tauri/target/release/bundle/nsis/$(basename "$f")"
          done
          for f in signpath-out/*.msi; do
            [ -f "$f" ] && cp "$f" "src-tauri/target/release/bundle/msi/$(basename "$f")"
          done
          # 2) 用 tauri signer 重新生成 .sig（Authenticode 签名改变了文件 hash）
          for f in src-tauri/target/release/bundle/nsis/*.exe \
                   src-tauri/target/release/bundle/msi/*.msi; do
            [ -f "$f" ] || continue
            pnpm exec tauri signer sign \
              --private-key-path <(echo "$TAURI_SIGNING_PRIVATE_KEY") \
              --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" "$f"
          done
          # 3) 覆盖上传到 draft release
          for f in src-tauri/target/release/bundle/nsis/*.exe \
                   src-tauri/target/release/bundle/nsis/*.exe.sig \
                   src-tauri/target/release/bundle/msi/*.msi \
                   src-tauri/target/release/bundle/msi/*.msi.sig; do
            [ -f "$f" ] && gh release upload "${{ steps.tag.outputs.tag }}" "$f" --clobber
          done
```

> **`latest.json` 的一致性**：`tauri-action` 在 build 时已经生成了基于**未签名**产物的 `latest.json` 并上传。重签后产物 hash 变了，需要更新 `latest.json`。两个做法：
>
> 1. 简单做法：上面 step 3 末尾再追加 `cp src-tauri/target/release/bundle/*/latest.json ./ && gh release upload ... latest.json --clobber`，让最后一个 Windows job 写入的版本胜出（matrix 中其他平台没改产物 hash，所以 latest.json 的 macOS/Linux 部分一致）。
> 2. 稳健做法：把 build matrix 的 `tauri-action` 改成 `releaseDraft: true` 且**不**生成 `latest.json`（去掉 `includeUpdaterJson`），增加一个独立 `finalize` job 在所有平台 build+sign 完成后扫描 release assets 重算 `latest.json` 并上传。

## 验证

CI 完成后下载签名后的 `.exe`：

1. **GUI 验证**：右键 → 属性 → "数字签名"标签页 → 签名者应是你在 SignPath 注册时填的真实身份，签发者 `Certum Code Signing 2021 CA`，状态"此数字签名正常"。
2. **命令行验证**（PowerShell）：
   ```powershell
   Get-AuthenticodeSignature .\cent_x.y.z_x64-setup.exe | Format-List *
   # Status: Valid
   # SignerCertificate.Subject: CN=<你的名字>, ...
   ```
3. **SmartScreen 真实测试**：在干净 Windows 上下载运行。
   - **第 1 阶段**（前几周/几百次下载）：弹"Windows Defender SmartScreen 阻止了不常下载的文件"，但点"更多信息"会显示**你的真实身份**作为发布者（而不是"未知发布者"），点"仍要运行"即可。
   - **第 2 阶段**（信誉积累后）：弹窗消失，与未签名/EV 签名表现一致。

## 常见问题

- **`Origin verification failed`**：SignPath 通过 GitHub OIDC 验证调用来源。检查 Signing Policy 中配置的 repository / workflow path / ref 是否与实际触发的 release workflow 完全一致。改了 workflow 文件名或换分支都要更新。
- **`Artifact configuration error`**：默认模板不识别某些产物。在 Project → Artifact Configuration 编辑 XML，确保 `.exe` / `.msi` 都列了 PE 签名规则。SignPath 官方文档有 Tauri/Electron 模板可直接复用。
- **签名超时**：SignPath Foundation 通常 < 1 分钟返回，超过 5 分钟检查策略中是否误开了 "Manual Approver"。
- **`wait-for-completion: true` 卡住**：CI runner 与 SignPath 之间网络故障。可设 `service-unavailable-timeout-in-seconds: 600` 容忍。
- **后续闭源 / 拿不到 Foundation 资格**：SignPath 也卖商业 OV/EV，约 €600+/年；性价比低于直接迁移到 Azure Trusted Signing。

---

## 附录：Azure Trusted Signing

如果未来 `cent` 闭源或希望**立即**消除所有 SmartScreen 警告（OV 信誉积累期太长），可切换到 Azure Trusted Signing：

- 价格：$9.99/月
- 即时获得 Microsoft ID Verified CS CA 颁发的证书，SmartScreen 信誉与 EV 同级
- 一次性准备：注册 Azure → 创建 Trusted Signing Account（需 3 工作日身份审核）→ Certificate Profile（Public Trust）→ Azure AD App Registration + `Trusted Signing Certificate Profile Signer` 角色。
- GitHub Secrets：`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TS_ENDPOINT` / `AZURE_TS_ACCOUNT_NAME` / `AZURE_TS_PROFILE_NAME`。
- Workflow 把上面"Sign via SignPath"那一段换成：

  ```yaml
  - name: Sign Windows artifacts (Azure Trusted Signing)
    if: runner.os == 'Windows'
    uses: azure/trusted-signing-action@v0.5.1
    with:
      azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
      azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
      azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
      endpoint: ${{ secrets.AZURE_TS_ENDPOINT }}
      trusted-signing-account-name: ${{ secrets.AZURE_TS_ACCOUNT_NAME }}
      certificate-profile-name: ${{ secrets.AZURE_TS_PROFILE_NAME }}
      files-folder: src-tauri/target/release/bundle
      files-folder-filter: exe,msi
      files-folder-recurse: true
      file-digest: SHA256
      timestamp-rfc3161: http://timestamp.acs.microsoft.com
      timestamp-digest: SHA256
  ```

  之后的 "重签 .sig + 覆盖上传"步骤复用本文主体方案。
