# 正式桌面版交付约定

用户在 2026-09-17 明确选择只使用正式安装版。后续功能交付需更新安装包和本机 App，不能把源码提交或 Web 预览视为桌面更新完成。

## 每轮交付

1. 完成改动和相关测试，确认第三方来源、许可证及源文件完整性。
2. 提升根目录、desktop/web package、Tauri 配置、Cargo 包和锁文件中的应用版本；运行 `npm run version:check`。
3. 更新 CHANGELOG，运行测试、类型检查与桌面前端构建。
4. 推送发布提交并创建对应 `app-v<版本>` 标签，由 `.github/workflows/release.yml` 构建 Windows 安装包和更新签名。
5. 确认 Release 工作流全部成功，版本、安装包、`.sig` 和 `latest.json` 一致。构建失败不得宣称已发布。
6. 使用 App 内“检查更新”安装，或从同一正式 Release 下载并运行安装包。更新前正常关闭 App，保留用户知识库和现有设置。
7. 核对本机安装后的可执行文件版本，打开原 App 入口，确认本轮新增功能；记录无法完成的界面验证。

原 App 已支持启动时及运行期间定时检查正式 Release。设置中可控制自动检查。它不会读取本地源码或 Git 分支；实时加载源码需要独立开发版，当前用户不采用该方案。

## TypeWords 运行边界

0.2.8 安装包包含英语学习入口、书本 A 图标和插件适配界面。TypeWords 本身仍是独立本机服务（127.0.0.1:5567），需启动已有 TypeWords，随后在 App 中打开“英语学习”。第三方源码保存在仓库，不随知识库安装包自动部署 Node.js 服务。原有学习记录不自动迁移到桌面 WebView。

本机一键入口使用 `start-installed-with-english.cmd`：复用或后台启动 TypeWords，然后打开已安装的正式 App。它优先使用仓库内构建，其次查找与仓库同级的 `TypeWords-3.0.7`；也可向 `scripts/start-installed-desktop.ps1` 传入 `-TypeWordsPath`。需要已有 Node.js 和 TypeWords 构建。原来的 `start-knowledge-with-english.cmd` 仅供 Web 预览验证。

## 0.2.8 本机验收（2026-09-17）

- 正式 Release：[app-v0.2.8](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/releases/tag/app-v0.2.8)。
- 164 项测试、TypeWords 326 文件完整性检查、版本检查及桌面前端构建通过。
- 安装包 `Agent_0.2.8_x64-setup.exe` 的 SHA-256 与 GitHub 发布资产一致：`4dfd069ed1fcb4859dabfb9de1c01938f036b0624c8cfc85352414d4289c6db7`。
- 正式安装程序退出码为 0；本机已安装可执行文件版本由 0.2.7 升至 0.2.8。
- 重新打开正式 App，确认侧栏显示书本 A 图标，点击“英语学习”后成功加载 TypeWords 的词典选择、今日任务和学习统计页面。
- 未以测试操作修改学习记录；完整打字、发音和跨重启学习记录验收仍需另行完成。
