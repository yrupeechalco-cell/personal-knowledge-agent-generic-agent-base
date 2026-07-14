# Windows App 发布与更新

桌面端从 `0.2.0` 起接入 Tauri 签名更新器。客户端启动约 2 秒后检查 GitHub 最新 Release，运行期间每 6 小时再检查一次；发现更高版本时显示更新窗口，由用户决定立即安装或稍后提醒。

## 一次性配置

1. 将本机 `.private/updater/knowledge-agent.key` 的完整内容保存为仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`。
2. 将本机 `.private/updater/password.txt` 的完整内容保存为仓库 Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
3. 私钥、API key、`.private` 目录不得提交。仓库只保存验签公钥。

丢失签名私钥后，已安装客户端将无法信任用新密钥签出的更新。应离线备份该文件，并限制可读取人员。

## 发布一次新版本

1. 同步修改根 `package.json`、桌面 `package.json`、`src-tauri/Cargo.toml` 与 `tauri.conf.json` 的 SemVer。
2. 运行 `npm run version:check`、`npm test`、`npm run typecheck`。
3. 提交并推送后运行 `powershell -ExecutionPolicy Bypass -File scripts/publish-windows-release.ps1 -Version X.Y.Z`。
4. 脚本构建 Windows NSIS 安装包、签名更新产物，并在 GitHub Release 发布 ASCII 文件名的安装包与 `latest.json`。客户端通过该文件检测更新。

仓库同时准备了 GitHub Actions 发布工作流；如果当前 GitHub 凭据具有 `workflow` scope，可以提交 `.github/workflows/release.yml` 后改用云端构建。没有该 scope 时，本机发布脚本是完整可用的正式后备路径，不影响客户端更新协议。

## 重要边界

- `0.1.x` 客户端没有更新器，必须手动安装一次 `0.2.0`；从 `0.2.0` 开始才可收到后续客户端提醒。
- Release 工作流没有签名 Secret 时会失败，这是安全保护，不应绕过。
- 发布前不得把 DeepSeek API key 或本地知识库内容写入 Release、日志或仓库。
