# 个人知识库 Agent

一个本地优先的 Obsidian-like 知识库桌面 App。它用普通 Markdown 文件作为知识库格式，提供文件树、关系图谱、标签页、笔记编辑、草稿写回和右侧 Note Agent 工作台。

当前公开版本的重点是：别人可以下载安装到自己的 Windows 电脑上，选择自己的本地知识库文件夹，填入自己的模型 API Key 后开始使用。

## 下载使用

1. 到 GitHub Releases 下载最新的 Windows 安装包。
2. 安装并启动 `个人知识库 Agent`。
3. 点击左上角文件夹入口，选择或新建一个本地知识库文件夹。
4. 在右侧 Note Agent 面板点击 Agent 设置，填入你自己的 DeepSeek API Key。
5. 新建、编辑、删除会先进入草稿/确认流程，确认后才写回本地磁盘。

安装包不会内置任何人的 API Key。每个用户都需要填写自己的 key。

## 功能概览

- 本地 Markdown 知识库：普通文件夹即可，不依赖 Obsidian。
- Obsidian-like 双链：支持 `[[笔记]]`、反链、标签和附件引用解析。
- 关系图谱：支持缩放、拖拽、节点选择和大库下的文字淡隐。
- 文件/TUI 视图：左侧按文件夹层级展示笔记，可右键新建、删除、重命名、复制、剪切。
- 草稿写回：新建、修改、删除先记录在会话改动层，确认后才写入真实文件。
- Note Agent：通过受控 App 工具读写当前知识库、打开笔记、创建笔记、显示图谱、生成复杂测试文档等。
- 模型接口：当前默认面向 DeepSeek V4 Pro / Flash，底层保留 provider 抽象，后续可以扩展到其他兼容模型。

## 隐私边界

- 仓库不包含用户 API Key。
- 安装包不包含用户 API Key。
- API Key 由用户在本机填写，桌面端保存在本机 App 配置目录，不提交到 GitHub。
- 真实知识库文件夹不会自动上传。
- 默认安全规则会排除 `.git`、`.obsidian`、`.claude`、`.venv`、`node_modules`、`.env`、`secret`、`token`、密码、账号等敏感路径。
- GitHub 同步功能的目标是后续让用户主动选择 repo、确认 diff、确认安全清单后再提交。

更多说明见 [docs/AGENT_INSTALL_AND_PRIVACY.md](docs/AGENT_INSTALL_AND_PRIVACY.md)。

## 开发运行

安装依赖：

```bash
npm install
```

启动桌面端前端开发入口：

```bash
npm run dev
```

打开 Tauri 桌面 App：

```bash
npm run tauri:dev
```

启动 Web 预览入口：

```bash
npm run dev:web
```

构建 Windows 安装包：

```bash
npm run tauri:build
```

构建成功后会生成类似：

```text
apps/desktop/src-tauri/target/release/bundle/nsis/个人知识库 Agent_0.1.1_x64-setup.exe
```

## 包结构

```text
apps/web
  浏览器预览入口，使用 Demo vault 或 showDirectoryPicker() 读取本地文件夹。

apps/desktop
  Tauri 桌面入口，负责本地文件、设置、模型 key、草稿写回和 Git 命令。

packages/workspace
  共享三栏工作台 App shell。

packages/core
  Markdown、wikilink、标签、图谱和安全清单解析。

packages/agent
  GenericAgent-inspired 笔记 Agent 内核、工具调用和权限规则。

packages/ui
  文件树、编辑器、星状图、微缩图谱和 Agent console 组件。
```

## 验证

```bash
npm run typecheck
npm test
npm run build:web
npm run build -w apps/desktop
npm run tauri:build
```

公开发布前还应运行密钥扫描，确认没有 `sk-...`、`.env`、`secrets.json` 等私密内容进入仓库。
