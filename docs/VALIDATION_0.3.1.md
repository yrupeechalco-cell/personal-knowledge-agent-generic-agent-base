# 左侧功能直接切换：0.3.1 验收

日期：2026-09-20。

## 发布与安装

- 安装包源码：`75e0184b98bba037cd87fe370193ae75242fd99e`；标签 `app-v0.3.1` 已核对指向该提交。
- [正式发布页](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/releases/tag/app-v0.3.1)。
- [Windows 构建与测试](https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/actions/runs/35506523772)：全部成功。
- 安装包 `Agent_0.3.1_x64-setup.exe`，4,234,148 字节。
- 下载后的 SHA-256 与 GitHub 发布资产摘要一致：`d99eb0bdac163aafef4ac3a6e3307ab47783d87c74a5d03a9412207ac0b9d1c6`。
- `latest.json` 版本、各 Windows 平台链接和安装包签名文件对应关系通过。
- 正常退出旧 App 后执行安装，退出码 0。原安装位置的 FileVersion、ProductVersion 均从 `0.3.0` 更新为 `0.3.1`。
- 源码发布于 `codex/typewords-plugin-foundations` 分支，本次未合并 `master`。

## 验证范围

- 本机工作区 95 项测试通过，包括左侧功能直接切换、没有功能标签时不显示顶部标签列表、已有文档标签保留、文档前进后退、TypeWords 切换后保留同一 iframe。
- 全工作区类型检查、Desktop 和 Web 前端构建通过。
- GitHub 发布工作流的完整 JavaScript 测试、Windows 原生测试、版本与内容检查、安装包签名和更新清单检查通过。
- 安装前观察到旧版顶部的关系图谱、知识画布、属性数据库和资源查询标签，与本次反馈一致。
- 安装后准备重新打开正式 App 做界面点击验收时，Computer Use 报告用户按物理 Escape 键停止控制，已停止后续界面操作。本轮没有宣称完成新版安装 App 的逐项点击实测。

## 用户检查

打开正式 App，依次点击左侧知识画布、资源查询、文件知识库和英语学习：主区域应直接切换，顶部不新增这些功能的标签；左侧当前功能高亮。英语学习切走再返回应保留当前页面。

打开具体笔记时，顶部仍可保留文档标签；窗口拖动、最小化、最大化和关闭保持可用。
