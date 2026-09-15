# 第三方来源与本轮代码说明

## TypeWords

- 项目：TypeWords，英语单词和文章打字练习软件。
- 上游作者/维护者：**zyronon 及 TypeWords 贡献者**。
- 上游仓库：<https://github.com/zyronon/TypeWords>
- 官方站点：<https://typewords.cc>
- 本次直接来源：用户提供的本地 **`TypeWords-3.0.7`** 文件夹，整理日期 **2026-09-16**。
- 本仓库存放位置：[third_party/typewords](third_party/typewords)。
- 原项目说明：[README](third_party/typewords/README.md)、[中文说明](third_party/typewords/docs/README.zh-CN.md)。
- 原许可证：保留完整 [GNU GPL version 3](third_party/typewords/LICENSE)，上游仓库标注 GPL-3.0。原文件内其他版权/许可声明一并保留；其中的词典、音频、图像及内嵌第三方库保留各自原声明。

这是用户提供的本地源码快照，不是本项目原创的英语学习软件。目录名中的 `3.0.7` 来自用户提供的文件夹；文件夹没有 Git 历史、package.json 没有 version 字段，因此**没有将它宣称为已验证的官方 3.0.7 标签或指定提交**，也没有假定它与上游当前 master 完全一致。

本轮未修改快照中的源码、资源、README 或许可证内容，仅移除构建/安装输出、开发缓存、环境文件和日志。逐文件 SHA-256 记录见 [TYPEWORDS_SOURCE_MANIFEST.json](docs/TYPEWORDS_SOURCE_MANIFEST.json)，可用 `npm run source:check` 验证。没有采集浏览器 IndexedDB/localStorage 中的学习记录。

## 本项目新增的适配代码

以下部分由本次知识库集成任务编写，使用 Codex 协助实现，不归为 TypeWords 上游原有功能：

- `packages/workspace/src/plugins/`：本地插件元数据、英语学习嵌入页、启停/重试及组件测试。
- `KnowledgeWorkspace.tsx` 中的英语学习按钮、标签页、页面保留逻辑。
- `scripts/start-local-plugins.ps1` 和 `start-knowledge-with-english.cmd`：知识库与已有 TypeWords 构建的联合启动。
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
