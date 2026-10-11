# 0.4.0 CLI 安装与接通记录

日期：2026-10-11。

## 已交付

- 源码分支：`codex/desktop-knowledge-cards`。
- 安装包对应提交：`feca99761a79c6fd324951b8c712c38f2c1a697e`。
- [Windows 构建流程](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/actions/runs/38103005907)：成功。工作区测试、类型检查、TypeWords/手机浏览器验证、原生索引与 CLI 验证、安装包和更新签名生成均已通过。
- 安装包：`Agent_0.4.0_x64-setup.exe`，44,835,126 字节。
- SHA-256：`eaa1a7c28e0c2a1f10b95e3388ec97944cc5781be615e85671a5b4d1443b7dc5`；下载后与 GitHub 附件 digest 一致。更新清单版本和附件签名文件一致。
- 安装包已上传 GitHub 的 `app-v0.4.0` 草稿，未替换面向其他电脑的公开 latest 版本。

## 本机实际连接

- 正式安装版从 0.3.6 更新到 0.4.0。
- 使用安装目录内的 `knowledge-cli.cmd` 读取到 `enabled=true`、`ready=true`，39 个方法。
- 成功执行 `library.status`、`app.show`、`app.state`；软件实际主视图切换至 `library`，随后打开 CLI 设置面板。
- 现有资料数量为 8，监测文件夹数量为 1。核对过程未调用扫描、标注或原文写入命令。
- 原应用设置和 v3 索引已保存在工作区 `.artifacts/cli-upgrade-backup-0.4.0/`，属于本机私有备份，不提交 GitHub。

## 回滚

源码改造前标记：`rollback/desktop-before-codex-cli-2026-10-11`。上一份公开安装包为 0.3.6；0.3.7 未发布。详见 [CLI 使用说明](CODEX_CLI.md)。

安装验证覆盖了真实客户端的通信、资料状态读取和页面控制；笔记写入、版本冲突、备份撤销和目录边界通过临时测试目录验证，没有在用户原件上进行试写。
