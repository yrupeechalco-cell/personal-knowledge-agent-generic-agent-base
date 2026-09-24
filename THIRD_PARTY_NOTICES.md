# 第三方来源与本轮代码说明

## TypeWords

- 项目：TypeWords，英语单词和文章打字练习软件。
- 上游作者/维护者：**zyronon 及 TypeWords 贡献者**。
- 上游仓库：<https://github.com/zyronon/TypeWords>
- 官方站点：<https://typewords.cc>
- GitHub 核对日期：**2026-09-16**；已搜索并核对原仓库 [zyronon/TypeWords](https://github.com/zyronon/TypeWords)、[上游 README](https://github.com/zyronon/TypeWords/blob/master/README.md) 和 [上游 LICENSE](https://github.com/zyronon/TypeWords/blob/master/LICENSE)。这些链接用于项目身份与许可来源引用，不代表本地快照与上游当前分支逐文件一致。
- 本次直接来源：用户提供的本地 **`TypeWords-3.0.7`** 文件夹，整理日期 **2026-09-16**。
- 本仓库存放位置：[third_party/typewords](third_party/typewords)。
- 原项目说明：[README](third_party/typewords/README.md)、[中文说明](third_party/typewords/docs/README.zh-CN.md)。
- 原许可证：保留完整 [GNU GPL version 3](third_party/typewords/LICENSE)，上游仓库标注 GPL-3.0。原文件内其他版权/许可声明一并保留；其中的词典、音频、图像及内嵌第三方库保留各自原声明。

这是用户提供的本地源码快照，不是本项目原创的英语学习软件。目录名中的 `3.0.7` 来自用户提供的文件夹；文件夹没有 Git 历史、package.json 没有 version 字段，因此**没有将它宣称为已验证的官方 3.0.7 标签或指定提交**，也没有假定它与上游当前 master 完全一致。

本轮未修改快照中的源码、资源、README 或许可证内容，仅移除构建/安装输出、开发缓存、环境文件和日志。逐文件 SHA-256 记录见 [TYPEWORDS_SOURCE_MANIFEST.json](docs/TYPEWORDS_SOURCE_MANIFEST.json)，可用 `npm run source:check` 验证。没有采集浏览器 IndexedDB/localStorage 中的学习记录。

## 本项目新增的适配代码

从知识库 0.3.2 起，Windows 安装包包含该快照生成的 TypeWords 生产输出，连同原 GPL-3.0 LICENSE、指向同版本完整源码及构建方法的 SOURCE.md 一起分发。源码快照仍保持未修改；隔离构建目录、打包与完整性检查脚本属于本项目的集成代码。Release 自动提供的源码 ZIP 包含快照、依赖锁文件及这些构建脚本。

### 内置 Node.js

- 固定版本：Node.js 24.14.0，Windows x64，来自 [Node.js 官方发行目录](https://nodejs.org/dist/v24.14.0/)。
- 官方 ZIP SHA-256：`313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66`。
- 可执行文件 SHA-256：`63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088`。
- Node.js 的 MIT 及内含组件的完整许可说明随安装包保存在 `plugins/typewords/runtime/LICENSE`；TypeWords 生产依赖输出保留各自许可证。

### 适配文件

以下部分由本次知识库集成任务编写，使用 Codex 协助实现，不归为 TypeWords 上游原有功能：

- `packages/workspace/src/plugins/`：本地插件元数据、英语学习嵌入页、启停/重试及组件测试。
- `KnowledgeWorkspace.tsx` 中的英语学习按钮、标签页、页面保留逻辑。
- `scripts/start-local-plugins.ps1` 和 `start-knowledge-with-english.cmd`：知识库与已有 TypeWords 构建的联合启动。
- `scripts/prepare-typewords.ps1`、`copy-typewords-build-source.mjs`、`stage-typewords.mjs`、`check-typewords-bundle.mjs`、`smoke-typewords-bundle.mjs`：便携生产构建、来源与运行环境校验。
- 知识库 Markdown 阅读改进、Agent 大幅改写提案及旧提案检查。

集成通过独立本机服务和 iframe 完成；目前没有把学习记录同步成知识库笔记，也没有向 TypeWords 开放笔记文件或 Agent 工具。

## 使用的 npm 库

以下库通过包管理器使用，依赖树与精确解析版本以各自锁文件为准，不将 node_modules 提交进仓库：

| 组件 | 来源 | 用途 | 包元数据许可证 |
| --- | --- | --- | --- |
| react-markdown | <https://github.com/remarkjs/react-markdown> | Markdown 阅读 | MIT |
| remark-gfm | <https://github.com/remarkjs/remark-gfm> | 表格、任务列表等 GFM 语法 | MIT |
| lucide-react | <https://github.com/lucide-icons/lucide> | 工具栏图标，含 BookA | ISC |

本文件是来源记录，不替换第三方许可证，也不把整个知识库项目重新授权为第三方的许可证。
